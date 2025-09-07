const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log(
    "Account balance:",
    (await ethers.provider.getBalance(deployer.address)).toString()
  );

  console.log("\n=== Deploying Treasury Contract ===");
  const TreasuryContract = await ethers.getContractFactory("TreasuryContract");
  const treasuryContract = await TreasuryContract.deploy(
    "0x0000000000000000000000000000000000000000"
  );
  await treasuryContract.waitForDeployment();

  const treasuryAddress = await treasuryContract.getAddress();
  console.log("TreasuryContract deployed to:", treasuryAddress);

  console.log("\n=== Deploying Validator DAO ===");
  const ValidatorDAO = await ethers.getContractFactory("ValidatorDAO");
  const validatorDAO = await ValidatorDAO.deploy(treasuryAddress);
  await validatorDAO.waitForDeployment();

  const daoAddress = await validatorDAO.getAddress();
  console.log("ValidatorDAO deployed to:", daoAddress);

  console.log("\n=== Updating Treasury DAO Reference ===");
  await treasuryContract.updateDAOContract(daoAddress);
  console.log("Treasury contract updated with DAO address");

  console.log("\n=== Setup Example Validators ===");
  const validators = [
    "0x1234567890123456789012345678901234567890", // Example validator addresses
    "0x2345678901234567890123456789012345678901",
    "0x3456789012345678901234567890123456789012",
  ];

  for (let i = 0; i < validators.length; i++) {
    await validatorDAO.addValidator(validators[i]);
    console.log(`Added validator ${i + 1}:`, validators[i]);
  }

  console.log("\n=== Setup Example Carbon Credit Options ===");
  await validatorDAO.addCarbonCreditOption(
    "0x4567890123456789012345678901234567890123",
    "EcoCredits Premium",
    "High quality verified carbon credits from renewable energy projects",
    ethers.parseEther("0.05")
  );

  await validatorDAO.addCarbonCreditOption(
    "0x5678901234567890123456789012345678901234",
    "ForestGuard Credits",
    "Carbon credits from forest conservation and reforestation projects",
    ethers.parseEther("0.08")
  );

  console.log("Added 2 carbon credit options");

  console.log("\n=== Deployment Summary ===");
  console.log("TreasuryContract:", treasuryAddress);
  console.log("ValidatorDAO:", daoAddress);
  console.log("Validators added:", validators.length);
  console.log("Carbon credit options added: 2");

  console.log("\n=== Contract Verification Commands ===");
  console.log(
    `npx hardhat verify --network <network> ${treasuryAddress} "0x0000000000000000000000000000000000000000"`
  );
  console.log(
    `npx hardhat verify --network <network> ${daoAddress} "${treasuryAddress}"`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
