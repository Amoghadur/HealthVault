const hre = require("hardhat");

async function main() {
  console.log("Deploy started");

  const HealthVault = await hre.ethers.getContractFactory("HealthVault");

  const healthVault = await HealthVault.deploy();

  await healthVault.waitForDeployment();

  console.log(
    "HealthVault deployed to:",
    await healthVault.getAddress()
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
