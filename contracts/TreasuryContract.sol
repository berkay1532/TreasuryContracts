// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract TreasuryContract is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");
    bytes32 public constant TREASURY_MANAGER_ROLE =
        keccak256("TREASURY_MANAGER_ROLE");

    struct CarbonCreditPurchase {
        uint256 id;
        uint256 amount;
        address provider;
        string details;
        uint256 timestamp;
        bool executed;
    }

    mapping(uint256 => CarbonCreditPurchase) public carbonCreditPurchases;
    mapping(address => uint256) public contributorBalances;
    mapping(address => bool) public authorizedRecipients;

    uint256 public purchaseCount;
    uint256 public totalCarbonCreditsPurchased;
    uint256 public emergencyWithdrawDelay = 2 days; // Emergency withdraw için gecikme
    uint256 public emergencyWithdrawRequestTime;
    bool public emergencyWithdrawRequested;

    address public daoContract;

    event FundsDeposited(address indexed contributor, uint256 amount);
    event FundsWithdrawn(address indexed recipient, uint256 amount);
    event CarbonCreditPurchaseExecuted(
        uint256 indexed purchaseId,
        uint256 amount,
        address indexed provider,
        string details
    );
    event EmergencyWithdrawRequested(
        address indexed admin,
        uint256 requestTime
    );
    event EmergencyWithdrawal(address indexed admin, uint256 amount);
    event DAOContractUpdated(address indexed oldDAO, address indexed newDAO);

    modifier onlyDAO() {
        require(hasRole(DAO_ROLE, msg.sender), "Not authorized DAO");
        _;
    }

    modifier onlyTreasuryManager() {
        require(
            hasRole(TREASURY_MANAGER_ROLE, msg.sender),
            "Not treasury manager"
        );
        _;
    }

    modifier validAddress(address _addr) {
        require(_addr != address(0), "Invalid address");
        _;
    }

    constructor(address _daoContract) validAddress(_daoContract) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(TREASURY_MANAGER_ROLE, msg.sender);
        _grantRole(DAO_ROLE, _daoContract);
        daoContract = _daoContract;
    }

    receive() external payable {
        deposit();
    }

    fallback() external payable {
        deposit();
    }

    function deposit() public payable whenNotPaused {
        require(msg.value > 0, "Must send ETH");

        contributorBalances[msg.sender] += msg.value;

        emit FundsDeposited(msg.sender, msg.value);
    }

    function executeCarbonCreditPurchase(
        uint256 amount,
        address provider,
        string memory details
    ) external onlyDAO nonReentrant whenNotPaused validAddress(provider) {
        require(amount > 0, "Amount must be greater than 0");
        require(address(this).balance >= amount, "Insufficient funds");
        require(bytes(details).length > 0, "Details required");

        purchaseCount++;
        carbonCreditPurchases[purchaseCount] = CarbonCreditPurchase({
            id: purchaseCount,
            amount: amount,
            provider: provider,
            details: details,
            timestamp: block.timestamp,
            executed: true
        });

        totalCarbonCreditsPurchased += amount;

        (bool success, ) = payable(provider).call{value: amount}("");
        require(success, "Transfer to provider failed");

        emit CarbonCreditPurchaseExecuted(
            purchaseCount,
            amount,
            provider,
            details
        );
    }

    function withdraw(
        uint256 amount,
        address recipient
    )
        external
        onlyTreasuryManager
        nonReentrant
        whenNotPaused
        validAddress(recipient)
    {
        require(amount > 0, "Amount must be greater than 0");
        require(address(this).balance >= amount, "Insufficient funds");
        require(authorizedRecipients[recipient], "Recipient not authorized");

        (bool success, ) = payable(recipient).call{value: amount}("");
        require(success, "Withdrawal failed");

        emit FundsWithdrawn(recipient, amount);
    }

    // Emergency withdraw için iki aşamalı sistem
    function requestEmergencyWithdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyWithdrawRequested = true;
        emergencyWithdrawRequestTime = block.timestamp;

        emit EmergencyWithdrawRequested(msg.sender, block.timestamp);
    }

    function executeEmergencyWithdraw()
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(emergencyWithdrawRequested, "Emergency withdraw not requested");
        require(
            block.timestamp >=
                emergencyWithdrawRequestTime + emergencyWithdrawDelay,
            "Emergency withdraw delay not passed"
        );

        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");

        emergencyWithdrawRequested = false;
        emergencyWithdrawRequestTime = 0;

        (bool success, ) = payable(msg.sender).call{value: balance}("");
        require(success, "Emergency withdrawal failed");

        emit EmergencyWithdrawal(msg.sender, balance);
    }

    function cancelEmergencyWithdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyWithdrawRequested = false;
        emergencyWithdrawRequestTime = 0;
    }

    function addAuthorizedRecipient(
        address recipient
    ) external onlyRole(DEFAULT_ADMIN_ROLE) validAddress(recipient) {
        authorizedRecipients[recipient] = true;
    }

    function removeAuthorizedRecipient(
        address recipient
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedRecipients[recipient] = false;
    }

    function updateDAOContract(
        address newDAO
    ) external onlyRole(DEFAULT_ADMIN_ROLE) validAddress(newDAO) {
        address oldDAO = daoContract;
        _revokeRole(DAO_ROLE, oldDAO);
        _grantRole(DAO_ROLE, newDAO);
        daoContract = newDAO;

        emit DAOContractUpdated(oldDAO, newDAO);
    }

    function setEmergencyWithdrawDelay(
        uint256 _delay
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_delay >= 1 days, "Delay must be at least 1 day");
        emergencyWithdrawDelay = _delay;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // View functions
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getCarbonCreditPurchase(
        uint256 purchaseId
    )
        external
        view
        returns (
            uint256 id,
            uint256 amount,
            address provider,
            string memory details,
            uint256 timestamp,
            bool executed
        )
    {
        CarbonCreditPurchase memory purchase = carbonCreditPurchases[
            purchaseId
        ];
        return (
            purchase.id,
            purchase.amount,
            purchase.provider,
            purchase.details,
            purchase.timestamp,
            purchase.executed
        );
    }

    function getContributorBalance(
        address contributor
    ) external view returns (uint256) {
        return contributorBalances[contributor];
    }

    function getTreasuryStats()
        external
        view
        returns (
            uint256 currentBalance,
            uint256 totalContributions,
            uint256 totalSpentOnCredits,
            uint256 purchaseCount_
        )
    {
        // totalContributions hesaplama
        totalContributions =
            address(this).balance +
            totalCarbonCreditsPurchased;

        return (
            address(this).balance,
            totalContributions,
            totalCarbonCreditsPurchased,
            purchaseCount
        );
    }
}
