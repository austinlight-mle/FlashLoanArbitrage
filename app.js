require("dotenv/config");
require("./server/index.js");

const config = require("./config/config.json");
const { getTokenAndContract } = require("./utils/helper.js");
const { provider } = require("./utils/initialization.js");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

const TOKEN_A = config.TOKENS.TOKEN_A;
const TOKEN_B = config.TOKENS.TOKEN_B;
const POOL_FEE = config.POOL_FEE;
const UNITS = config.PROJECT_SETTINGS.UNITS;
const PRICE_DIFFERENCE = config.PROJECT_SETTINGS.PRICE_DIFFERENCE;
const GAS_LIMIT = config.PROJECT_SETTINGS.GAS_LIMIT;
const GAS_PRICE = config.PROJECT_SETTINGS.GAS_PRICE;

const main = async () => {
  console.log("Starting Flash Loan Arbitrage Bot...");

  const { tokenA, tokenB } = await getTokenAndContract(TOKEN_A, TOKEN_B, provider);

  console.log(`Token A: ${tokenA}`);
};

main().catch((error) => {
  console.error("Error in Flash Loan Arbitrage Bot:", error);
  process.exit(1);
});
