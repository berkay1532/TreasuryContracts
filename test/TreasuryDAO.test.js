const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Treasury DAO System", function () {
  let treasuryContract, validatorDAO;
  let owner, validator1, validator2, validator3, carbonProvider, user;

  beforeEach(async function () {
    [owner, validator1, validator2, validator3, carbonProvider, user] =
      await ethers.getSigners();

    const TreasuryContract = await ethers.getContractFactory(
      "TreasuryContract"
    );
    const ValidatorDAO = await ethers.getContractFactory("ValidatorDAO");

    // Deploy the treasury with a temporary address first
    treasuryContract = await TreasuryContract.deploy(
      "0x0000000000000000000000000000000000000001"
    );
    await treasuryContract.waitForDeployment();

    // Deploy the DAO with the treasury address
    validatorDAO = await ValidatorDAO.deploy(
      await treasuryContract.getAddress()
    );
    await validatorDAO.waitForDeployment();

    // Update the DAO address in the Treasury
    await treasuryContract.updateDAOContract(await validatorDAO.getAddress());

    // Add validators
    await validatorDAO.addValidator(validator1.address);
    await validatorDAO.addValidator(validator2.address);
    await validatorDAO.addValidator(validator3.address);
  });

  describe("TreasuryContract", function () {
    it("Should allow deposits", async function () {
      const depositAmount = ethers.parseEther("1.0");

      await treasuryContract.connect(user).deposit({ value: depositAmount });

      expect(await treasuryContract.getContractBalance()).to.equal(
        depositAmount
      );
      expect(
        await treasuryContract.getContributorBalance(user.address)
      ).to.equal(depositAmount);
    });

    it("Should allow deposits via receive function", async function () {
      const depositAmount = ethers.parseEther("2.0");

      await user.sendTransaction({
        to: await treasuryContract.getAddress(),
        value: depositAmount,
      });

      expect(await treasuryContract.getContractBalance()).to.equal(
        depositAmount
      );
    });

    it("Should execute carbon credit purchase when called by DAO", async function () {
      const depositAmount = ethers.parseEther("5.0");
      const purchaseAmount = ethers.parseEther("1.0");

      // First, deposit funds into the treasury
      await treasuryContract.connect(user).deposit({ value: depositAmount });

      const initialProviderBalance = await ethers.provider.getBalance(
        carbonProvider.address
      );

      // Since ValidatorDAO has no receive/fallback, use a direct function call from the DAO address
      await ethers.provider.send("hardhat_impersonateAccount", [
        await validatorDAO.getAddress(),
      ]);

      // Give the DAO 100 ETH balance (sets node state; this is not a transfer)
      await ethers.provider.send("hardhat_setBalance", [
        await validatorDAO.getAddress(),
        "0x56BC75E2D63100000", // 100 ETH (wei) = 100 * 1e18
      ]);

      const impersonatedDAO = await ethers.getSigner(
        await validatorDAO.getAddress()
      );

      // Execute the carbon credit purchase
      await treasuryContract
        .connect(impersonatedDAO)
        .executeCarbonCreditPurchase(
          purchaseAmount,
          carbonProvider.address,
          "Test carbon credits"
        );

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        await validatorDAO.getAddress(),
      ]);

      // Verify results
      const finalProviderBalance = await ethers.provider.getBalance(
        carbonProvider.address
      );
      expect(finalProviderBalance - initialProviderBalance).to.equal(
        purchaseAmount
      );

      const purchase = await treasuryContract.getCarbonCreditPurchase(1);
      expect(purchase.amount).to.equal(purchaseAmount);
      expect(purchase.provider).to.equal(carbonProvider.address);
      expect(purchase.executed).to.be.true;
    });

    it("Should not allow non-DAO to execute carbon credit purchase", async function () {
      const purchaseAmount = ethers.parseEther("1.0");

      await expect(
        treasuryContract
          .connect(user)
          .executeCarbonCreditPurchase(
            purchaseAmount,
            carbonProvider.address,
            "Test carbon credits"
          )
      ).to.be.revertedWith("Not authorized DAO");
    });

    it("Should handle emergency withdrawal with delay", async function () {
      const depositAmount = ethers.parseEther("3.0");
      await treasuryContract.connect(user).deposit({ value: depositAmount });

      // Submit emergency withdrawal request
      await expect(
        treasuryContract.connect(owner).requestEmergencyWithdraw()
      ).to.emit(treasuryContract, "EmergencyWithdrawRequested");

      // Attempt to withdraw immediately — should fail
      await expect(
        treasuryContract.connect(owner).executeEmergencyWithdraw()
      ).to.be.revertedWith("Emergency withdraw delay not passed");

      // Advance time beyond the delay (2 days + 1 second)
      await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      const initialOwnerBalance = await ethers.provider.getBalance(
        owner.address
      );

      const tx = await treasuryContract
        .connect(owner)
        .executeEmergencyWithdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      const balanceIncrease = finalOwnerBalance - initialOwnerBalance + gasUsed;

      expect(balanceIncrease).to.equal(depositAmount);
      expect(await treasuryContract.getContractBalance()).to.equal(0);
    });

    it("Should allow cancelling emergency withdrawal", async function () {
      await treasuryContract.connect(owner).requestEmergencyWithdraw();
      await treasuryContract.connect(owner).cancelEmergencyWithdraw();

      // Advance time arbitrarily; withdraw should still be blocked because it's cancelled
      await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");

      await expect(
        treasuryContract.connect(owner).executeEmergencyWithdraw()
      ).to.be.revertedWith("Emergency withdraw not requested");
    });
  });

  describe("ValidatorDAO", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseEther("10.0");
      await treasuryContract.connect(user).deposit({ value: depositAmount });
    });

    it("Should allow validators to create proposals", async function () {
      const proposalTx = await validatorDAO
        .connect(validator1)
        .createProposal(
          "Purchase carbon credits from Provider A",
          ethers.parseEther("2.0"),
          carbonProvider.address,
          "High quality carbon credits - 100 tons CO2"
        );

      await expect(proposalTx)
        .to.emit(validatorDAO, "ProposalCreated")
        .withArgs(
          1,
          validator1.address,
          "Purchase carbon credits from Provider A",
          ethers.parseEther("2.0"),
          carbonProvider.address
        );

      const proposal = await validatorDAO.getProposal(1);
      expect(proposal.description).to.equal(
        "Purchase carbon credits from Provider A"
      );
      expect(proposal.amount).to.equal(ethers.parseEther("2.0"));
      expect(proposal.proposer).to.equal(validator1.address);
    });

    it("Should not allow creating proposals exceeding treasury balance", async function () {
      await expect(
        validatorDAO.connect(validator1).createProposal(
          "Expensive proposal",
          ethers.parseEther("20.0"), // The treasury has only 10 ETH
          carbonProvider.address,
          "Test details"
        )
      ).to.be.revertedWith("Insufficient treasury funds");
    });

    it("Should not allow non-validators to create proposals", async function () {
      await expect(
        validatorDAO
          .connect(user)
          .createProposal(
            "Test proposal",
            ethers.parseEther("1.0"),
            carbonProvider.address,
            "Test details"
          )
      ).to.be.revertedWith("Not a validator");
    });

    it("Should allow validators to vote on proposals", async function () {
      await validatorDAO
        .connect(validator1)
        .createProposal(
          "Test proposal",
          ethers.parseEther("1.0"),
          carbonProvider.address,
          "Test details"
        );

      await expect(validatorDAO.connect(validator2).vote(1, true))
        .to.emit(validatorDAO, "VoteCast")
        .withArgs(1, validator2.address, true);

      await validatorDAO.connect(validator3).vote(1, false);

      const proposal = await validatorDAO.getProposal(1);
      expect(proposal.votesFor).to.equal(1);
      expect(proposal.votesAgainst).to.equal(1);
    });

    it("Should not allow double voting", async function () {
      await validatorDAO
        .connect(validator1)
        .createProposal(
          "Test proposal",
          ethers.parseEther("1.0"),
          carbonProvider.address,
          "Test details"
        );

      await validatorDAO.connect(validator2).vote(1, true);

      await expect(
        validatorDAO.connect(validator2).vote(1, false)
      ).to.be.revertedWith("Already voted");
    });

    it("Should execute successful proposals with quorum", async function () {
      await validatorDAO
        .connect(validator1)
        .createProposal(
          "Test proposal",
          ethers.parseEther("1.0"),
          carbonProvider.address,
          "Test details"
        );

      // All 3 validators vote (quorum 51% => at least 2 validators)
      await validatorDAO.connect(validator1).vote(1, true);
      await validatorDAO.connect(validator2).vote(1, true);
      await validatorDAO.connect(validator3).vote(1, false);

      // Advance time past the voting period
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      const initialProviderBalance = await ethers.provider.getBalance(
        carbonProvider.address
      );

      await expect(validatorDAO.executeProposal(1))
        .to.emit(validatorDAO, "ProposalExecuted")
        .withArgs(1, true);

      const finalProviderBalance = await ethers.provider.getBalance(
        carbonProvider.address
      );
      expect(finalProviderBalance - initialProviderBalance).to.equal(
        ethers.parseEther("1.0")
      );

      const proposal = await validatorDAO.getProposal(1);
      expect(proposal.executed).to.be.true;
      expect(proposal.passed).to.be.true;
    });

    it("Should not execute proposals without quorum", async function () {
      await validatorDAO
        .connect(validator1)
        .createProposal(
          "Test proposal",
          ethers.parseEther("1.0"),
          carbonProvider.address,
          "Test details"
        );

      // Only 1 validator votes (quorum 51% of 3 = 1.53, rounded up to 2)
      await validatorDAO.connect(validator1).vote(1, true);

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      await expect(validatorDAO.executeProposal(1)).to.be.revertedWith(
        "Quorum not reached"
      );
    });

    it("Should not execute failed proposals", async function () {
      await validatorDAO
        .connect(validator1)
        .createProposal(
          "Test proposal",
          ethers.parseEther("1.0"),
          carbonProvider.address,
          "Test details"
        );

      // Majority votes "no"
      await validatorDAO.connect(validator1).vote(1, false);
      await validatorDAO.connect(validator2).vote(1, false);
      await validatorDAO.connect(validator3).vote(1, true);

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      await expect(validatorDAO.executeProposal(1))
        .to.emit(validatorDAO, "ProposalExecuted")
        .withArgs(1, false);

      const proposal = await validatorDAO.getProposal(1);
      expect(proposal.executed).to.be.true;
      expect(proposal.passed).to.be.false;
    });

    it("Should not execute proposals before voting period ends", async function () {
      await validatorDAO
        .connect(validator1)
        .createProposal(
          "Test proposal",
          ethers.parseEther("1.0"),
          carbonProvider.address,
          "Test details"
        );

      await validatorDAO.connect(validator1).vote(1, true);
      await validatorDAO.connect(validator2).vote(1, true);

      await expect(validatorDAO.executeProposal(1)).to.be.revertedWith(
        "Voting period not ended"
      );
    });

    it("Should add and remove validators properly", async function () {
      const newValidator = ethers.Wallet.createRandom().address;

      await expect(validatorDAO.connect(owner).addValidator(newValidator))
        .to.emit(validatorDAO, "ValidatorAdded")
        .withArgs(newValidator);

      expect(await validatorDAO.isValidator(newValidator)).to.be.true;
      expect(await validatorDAO.validatorCount()).to.equal(4);

      await expect(validatorDAO.connect(owner).removeValidator(newValidator))
        .to.emit(validatorDAO, "ValidatorRemoved")
        .withArgs(newValidator);

      expect(await validatorDAO.isValidator(newValidator)).to.be.false;
      expect(await validatorDAO.validatorCount()).to.equal(3);
    });

    it("Should not allow removing the last validator", async function () {
      // Try to remove all validators
      await validatorDAO.connect(owner).removeValidator(validator1.address);
      await validatorDAO.connect(owner).removeValidator(validator2.address);

      await expect(
        validatorDAO.connect(owner).removeValidator(validator3.address)
      ).to.be.revertedWith("Cannot remove last validator");
    });

    it("Should add and manage carbon credit options", async function () {
      await expect(
        validatorDAO
          .connect(owner)
          .addCarbonCreditOption(
            carbonProvider.address,
            "Premium Carbon Credits",
            "High quality verified carbon credits",
            ethers.parseEther("0.1")
          )
      )
        .to.emit(validatorDAO, "CarbonCreditOptionAdded")
        .withArgs(1, carbonProvider.address, "Premium Carbon Credits");

      const option = await validatorDAO.carbonCreditOptions(1);
      expect(option.provider).to.equal(carbonProvider.address);
      expect(option.name).to.equal("Premium Carbon Credits");
      expect(option.isActive).to.be.true;

      // Deactivate the option
      await expect(validatorDAO.connect(owner).deactivateCarbonCreditOption(1))
        .to.emit(validatorDAO, "CarbonCreditOptionDeactivated")
        .withArgs(1);

      const deactivatedOption = await validatorDAO.carbonCreditOptions(1);
      expect(deactivatedOption.isActive).to.be.false;
    });

    it("Should return active carbon credit options", async function () {
      // Add several options
      await validatorDAO
        .connect(owner)
        .addCarbonCreditOption(
          carbonProvider.address,
          "Option 1",
          "Details 1",
          ethers.parseEther("0.1")
        );

      await validatorDAO
        .connect(owner)
        .addCarbonCreditOption(
          validator1.address,
          "Option 2",
          "Details 2",
          ethers.parseEther("0.2")
        );

      await validatorDAO
        .connect(owner)
        .addCarbonCreditOption(
          validator2.address,
          "Option 3",
          "Details 3",
          ethers.parseEther("0.3")
        );

      // Deactivate one option
      await validatorDAO.connect(owner).deactivateCarbonCreditOption(2);

      const activeOptions = await validatorDAO.getActiveCarbonCreditOptions();
      expect(activeOptions.length).to.equal(2);
      expect(activeOptions[0]).to.equal(1);
      expect(activeOptions[1]).to.equal(3);
    });

    it("Should allow setting governance parameters", async function () {
      // Change voting period
      await validatorDAO.connect(owner).setVotingPeriod(5 * 24 * 60 * 60); // 5 days
      expect(await validatorDAO.votingPeriod()).to.equal(5 * 24 * 60 * 60);

      // Change minimum quorum
      await validatorDAO.connect(owner).setMinimumVotingQuorum(67); // 67%
      expect(await validatorDAO.minimumVotingQuorum()).to.equal(67);

      // Change minimum approval percentage
      await validatorDAO.connect(owner).setMinimumApprovalPercentage(60); // 60%
      expect(await validatorDAO.minimumApprovalPercentage()).to.equal(60);
    });

    it("Should get proposal voting statistics", async function () {
      await validatorDAO
        .connect(validator1)
        .createProposal(
          "Test proposal",
          ethers.parseEther("1.0"),
          carbonProvider.address,
          "Test details"
        );

      await validatorDAO.connect(validator1).vote(1, true);
      await validatorDAO.connect(validator2).vote(1, true);
      await validatorDAO.connect(validator3).vote(1, false);

      const stats = await validatorDAO.getProposalVotingStats(1);
      expect(stats.totalVotes).to.equal(3);
      expect(stats.requiredQuorum).to.equal(2); // Math.ceil(3 * 51 / 100) = Math.ceil(1.53) = 2
      expect(stats.approvalPercentage).to.equal(66); // Math.floor(2 * 100 / 3) = 66
      expect(stats.quorumReached).to.be.true;
    });
  });

  describe("Integration Tests", function () {
    it("Should complete full workflow: deposit → proposal → vote → execute → purchase", async function () {
      const depositAmount = ethers.parseEther("5.0");
      const purchaseAmount = ethers.parseEther("2.0");

      // 1. Deposit funds
      await treasuryContract.connect(user).deposit({ value: depositAmount });

      // 2. Create proposal
      await validatorDAO
        .connect(validator1)
        .createProposal(
          "Purchase premium carbon credits",
          purchaseAmount,
          carbonProvider.address,
          "Premium verified carbon credits - 50 tons CO2"
        );

      // 3. Vote
      await validatorDAO.connect(validator1).vote(1, true);
      await validatorDAO.connect(validator2).vote(1, true);
      await validatorDAO.connect(validator3).vote(1, false);

      // 4. Advance time past the voting period
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      const initialTreasuryBalance =
        await treasuryContract.getContractBalance();
      const initialProviderBalance = await ethers.provider.getBalance(
        carbonProvider.address
      );

      // 5. Execute the proposal
      await validatorDAO.executeProposal(1);

      const finalTreasuryBalance = await treasuryContract.getContractBalance();
      const finalProviderBalance = await ethers.provider.getBalance(
        carbonProvider.address
      );

      // 6. Verify results
      expect(initialTreasuryBalance - finalTreasuryBalance).to.equal(
        purchaseAmount
      );
      expect(finalProviderBalance - initialProviderBalance).to.equal(
        purchaseAmount
      );

      const treasuryStats = await treasuryContract.getTreasuryStats();
      expect(treasuryStats.totalSpentOnCredits).to.equal(purchaseAmount);
      expect(treasuryStats.purchaseCount_).to.equal(1);

      const purchase = await treasuryContract.getCarbonCreditPurchase(1);
      expect(purchase.executed).to.be.true;
      expect(purchase.amount).to.equal(purchaseAmount);
      expect(purchase.provider).to.equal(carbonProvider.address);
    });

    it("Should handle multiple proposals and purchases", async function () {
      const depositAmount = ethers.parseEther("10.0");
      await treasuryContract.connect(user).deposit({ value: depositAmount });

      // First proposal
      await validatorDAO
        .connect(validator1)
        .createProposal(
          "First purchase",
          ethers.parseEther("2.0"),
          carbonProvider.address,
          "First batch of carbon credits"
        );

      // Vote on the first proposal
      await validatorDAO.connect(validator1).vote(1, true);
      await validatorDAO.connect(validator2).vote(1, true);
      await validatorDAO.connect(validator3).vote(1, false);

      // Advance time and execute the first proposal
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      await validatorDAO.executeProposal(1);

      // Second proposal — with a new voting period
      await validatorDAO.connect(validator2).createProposal(
        "Second purchase",
        ethers.parseEther("3.0"),
        validator1.address, // Different provider
        "Second batch of carbon credits"
      );

      // Vote on the second proposal (new voting period starts automatically)
      await validatorDAO.connect(validator1).vote(2, true);
      await validatorDAO.connect(validator2).vote(2, true);
      await validatorDAO.connect(validator3).vote(2, true);

      // Advance time and execute the second proposal
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");

      await validatorDAO.executeProposal(2);

      // Verify results
      const treasuryStats = await treasuryContract.getTreasuryStats();
      expect(treasuryStats.totalSpentOnCredits).to.equal(
        ethers.parseEther("5.0")
      );
      expect(treasuryStats.purchaseCount_).to.equal(2);

      const finalBalance = await treasuryContract.getContractBalance();
      expect(finalBalance).to.equal(ethers.parseEther("5.0")); // 10 - 5 = 5
    });
  });
});
