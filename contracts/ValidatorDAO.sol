// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ValidatorDAO is AccessControl, ReentrancyGuard {
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        uint256 amount;
        address carbonCreditProvider;
        string carbonCreditDetails;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 startTime;
        uint256 endTime;
        bool executed;
        bool passed;
        mapping(address => bool) hasVoted;
        mapping(address => bool) vote;
    }

    struct CarbonCreditOption {
        address provider;
        string name;
        string details;
        uint256 pricePerCredit;
        bool isActive;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => CarbonCreditOption) public carbonCreditOptions;
    mapping(address => bool) public isValidator;

    uint256 public proposalCount;
    uint256 public carbonCreditOptionCount;
    uint256 public votingPeriod = 7 days;
    uint256 public validatorCount;
    uint256 public minimumVotingQuorum = 51; // Minimum %51 validator katılımı
    uint256 public minimumApprovalPercentage = 51; // Minimum %51 onay oranı

    address public treasuryContract;

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string description,
        uint256 amount,
        address carbonCreditProvider
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support
    );

    event ProposalExecuted(uint256 indexed proposalId, bool passed);

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event CarbonCreditOptionAdded(
        uint256 indexed optionId,
        address provider,
        string name
    );
    event CarbonCreditOptionDeactivated(uint256 indexed optionId);

    modifier onlyValidator() {
        require(hasRole(VALIDATOR_ROLE, msg.sender), "Not a validator");
        _;
    }

    modifier onlyTreasury() {
        require(hasRole(TREASURY_ROLE, msg.sender), "Not treasury contract");
        _;
    }

    modifier validAddress(address _addr) {
        require(_addr != address(0), "Invalid address");
        _;
    }

    modifier proposalExists(uint256 proposalId) {
        require(proposals[proposalId].id != 0, "Proposal does not exist");
        _;
    }

    constructor(address _treasuryContract) validAddress(_treasuryContract) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(TREASURY_ROLE, _treasuryContract);
        treasuryContract = _treasuryContract;
    }

    function addValidator(
        address validator
    ) external onlyRole(DEFAULT_ADMIN_ROLE) validAddress(validator) {
        require(!isValidator[validator], "Already a validator");
        require(validator != address(this), "Cannot add contract as validator");

        _grantRole(VALIDATOR_ROLE, validator);
        isValidator[validator] = true;
        validatorCount++;
        emit ValidatorAdded(validator);
    }

    function removeValidator(
        address validator
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(isValidator[validator], "Not a validator");
        require(validatorCount > 1, "Cannot remove last validator");

        _revokeRole(VALIDATOR_ROLE, validator);
        isValidator[validator] = false;
        validatorCount--;
        emit ValidatorRemoved(validator);
    }

    function addCarbonCreditOption(
        address provider,
        string memory name,
        string memory details,
        uint256 pricePerCredit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) validAddress(provider) {
        require(bytes(name).length > 0, "Name required");
        require(bytes(details).length > 0, "Details required");
        require(pricePerCredit > 0, "Price must be greater than 0");

        carbonCreditOptionCount++;
        carbonCreditOptions[carbonCreditOptionCount] = CarbonCreditOption({
            provider: provider,
            name: name,
            details: details,
            pricePerCredit: pricePerCredit,
            isActive: true
        });
        emit CarbonCreditOptionAdded(carbonCreditOptionCount, provider, name);
    }

    function deactivateCarbonCreditOption(
        uint256 optionId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(optionId <= carbonCreditOptionCount, "Invalid option ID");
        require(carbonCreditOptions[optionId].isActive, "Already inactive");

        carbonCreditOptions[optionId].isActive = false;
        emit CarbonCreditOptionDeactivated(optionId);
    }

    function createProposal(
        string memory description,
        uint256 amount,
        address carbonCreditProvider,
        string memory carbonCreditDetails
    )
        external
        onlyValidator
        validAddress(carbonCreditProvider)
        returns (uint256)
    {
        require(bytes(description).length > 0, "Description required");
        require(
            bytes(carbonCreditDetails).length > 0,
            "Carbon credit details required"
        );
        require(amount > 0, "Amount must be greater than 0");

        // Treasury'deki bakiyeyi kontrol et
        ITreasury treasury = ITreasury(treasuryContract);
        require(
            treasury.getContractBalance() >= amount,
            "Insufficient treasury funds"
        );

        proposalCount++;
        Proposal storage newProposal = proposals[proposalCount];
        newProposal.id = proposalCount;
        newProposal.proposer = msg.sender;
        newProposal.description = description;
        newProposal.amount = amount;
        newProposal.carbonCreditProvider = carbonCreditProvider;
        newProposal.carbonCreditDetails = carbonCreditDetails;
        newProposal.startTime = block.timestamp;
        newProposal.endTime = block.timestamp + votingPeriod;
        newProposal.executed = false;
        newProposal.passed = false;

        emit ProposalCreated(
            proposalCount,
            msg.sender,
            description,
            amount,
            carbonCreditProvider
        );

        return proposalCount;
    }

    function vote(
        uint256 proposalId,
        bool support
    ) external onlyValidator proposalExists(proposalId) {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp <= proposal.endTime, "Voting period ended");
        require(!proposal.hasVoted[msg.sender], "Already voted");

        proposal.hasVoted[msg.sender] = true;
        proposal.vote[msg.sender] = support;

        if (support) {
            proposal.votesFor++;
        } else {
            proposal.votesAgainst++;
        }

        emit VoteCast(proposalId, msg.sender, support);
    }

    function executeProposal(
        uint256 proposalId
    ) external nonReentrant proposalExists(proposalId) {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp > proposal.endTime, "Voting period not ended");
        require(!proposal.executed, "Proposal already executed");

        proposal.executed = true;

        uint256 totalVotes = proposal.votesFor + proposal.votesAgainst;
        uint256 requiredQuorum = (validatorCount * minimumVotingQuorum + 99) /
            100; // Math.ceil için

        require(totalVotes >= requiredQuorum, "Quorum not reached");

        // Yeterli onay oranı kontrolü
        uint256 approvalPercentage = (proposal.votesFor * 100) / totalVotes;

        if (approvalPercentage >= minimumApprovalPercentage) {
            proposal.passed = true;

            ITreasury(treasuryContract).executeCarbonCreditPurchase(
                proposal.amount,
                proposal.carbonCreditProvider,
                proposal.carbonCreditDetails
            );
        }

        emit ProposalExecuted(proposalId, proposal.passed);
    }

    // Governance parametrelerini ayarlama
    function setVotingPeriod(
        uint256 _votingPeriod
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_votingPeriod >= 1 hours, "Voting period too short");
        require(_votingPeriod <= 30 days, "Voting period too long");
        votingPeriod = _votingPeriod;
    }

    function setMinimumVotingQuorum(
        uint256 _quorum
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_quorum > 0 && _quorum <= 100, "Invalid quorum percentage");
        minimumVotingQuorum = _quorum;
    }

    function setMinimumApprovalPercentage(
        uint256 _percentage
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            _percentage > 50 && _percentage <= 100,
            "Invalid approval percentage"
        );
        minimumApprovalPercentage = _percentage;
    }

    // View functions
    function getProposal(
        uint256 proposalId
    )
        external
        view
        returns (
            uint256 id,
            address proposer,
            string memory description,
            uint256 amount,
            address carbonCreditProvider,
            string memory carbonCreditDetails,
            uint256 votesFor,
            uint256 votesAgainst,
            uint256 startTime,
            uint256 endTime,
            bool executed,
            bool passed
        )
    {
        Proposal storage proposal = proposals[proposalId];
        return (
            proposal.id,
            proposal.proposer,
            proposal.description,
            proposal.amount,
            proposal.carbonCreditProvider,
            proposal.carbonCreditDetails,
            proposal.votesFor,
            proposal.votesAgainst,
            proposal.startTime,
            proposal.endTime,
            proposal.executed,
            proposal.passed
        );
    }

    function hasVoted(
        uint256 proposalId,
        address voter
    ) external view returns (bool) {
        return proposals[proposalId].hasVoted[voter];
    }

    function getVote(
        uint256 proposalId,
        address voter
    ) external view returns (bool) {
        return proposals[proposalId].vote[voter];
    }

    function getProposalVotingStats(
        uint256 proposalId
    )
        external
        view
        returns (
            uint256 totalVotes,
            uint256 requiredQuorum,
            uint256 approvalPercentage,
            bool quorumReached
        )
    {
        Proposal storage proposal = proposals[proposalId];
        totalVotes = proposal.votesFor + proposal.votesAgainst;
        requiredQuorum = (validatorCount * minimumVotingQuorum + 99) / 100; // Math.ceil için
        if (totalVotes > 0) {
            approvalPercentage = (proposal.votesFor * 100) / totalVotes;
        }

        quorumReached = totalVotes >= requiredQuorum;
    }

    function getActiveCarbonCreditOptions()
        external
        view
        returns (uint256[] memory activeOptions)
    {
        uint256 activeCount = 0;

        // Aktif seçenekleri say
        for (uint256 i = 1; i <= carbonCreditOptionCount; i++) {
            if (carbonCreditOptions[i].isActive) {
                activeCount++;
            }
        }

        // Aktif seçenekleri döndür
        activeOptions = new uint256[](activeCount);
        uint256 index = 0;

        for (uint256 i = 1; i <= carbonCreditOptionCount; i++) {
            if (carbonCreditOptions[i].isActive) {
                activeOptions[index] = i;
                index++;
            }
        }
    }
}

interface ITreasury {
    function executeCarbonCreditPurchase(
        uint256 amount,
        address provider,
        string memory details
    ) external;

    function getContractBalance() external view returns (uint256);
}
