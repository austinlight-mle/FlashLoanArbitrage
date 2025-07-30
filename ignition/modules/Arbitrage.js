const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("TokenModule", (m) => {
  const DEPLOYER = m.getAccount(0);

  const Arbitrage = m.contract("Arbitrage", [], { from: DEPLOYER });

  return { Arbitrage };
});
