require("dotenv/config");
const { ethers } = require("ethers");

const config = require("../config/config.json");
const IUniswapV3Factory = require("@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json");
const IQuoter = require("@uniswap/v3-periphery/artifacts/contracts/interfaces/IQuoterV2.sol/IQuoterV2.json");
const ISwapRouter = require("@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json");

const { uniswapV3Abi, pancakeswapV3Abi } = require("./abi.js");

const NETWORK = config.PROJECT_SETTINGS.network;

let provider;

if (config.PROJECT_SETTINGS.isLocal) {
  provider = new ethers.WebSocketProvider("ws://localhost:8545");
} else if (NETWORK == "arbitrum") {
  provider = new ethers.WebSocketProvider(
    `wss://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
} else if (NETWORK == "ethereum") {
  provider = new ethers.WebSocketProvider(
    `wss://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
}

// -- SETUP UNISWAP/PANCAKESWAP CONTRACTS -- //
const uniswap = {
  name: "Uniswap V3",
  factory: new ethers.Contract(config.UniswapV3.factory, IUniswapV3Factory.abi, provider),
  quoter: new ethers.Contract(config.UniswapV3.quoter, IQuoter.abi, provider),
  router: new ethers.Contract(config.UniswapV3.router, ISwapRouter.abi, provider),
  abi: uniswapV3Abi,
};

const pancakeswap = {
  name: "Pancakeswap V3",
  factory: new ethers.Contract(config.PancakeswapV3.factory, IUniswapV3Factory.abi, provider),
  quoter: new ethers.Contract(config.PancakeswapV3.quoter, IQuoter.abi, provider),
  router: new ethers.Contract(config.PancakeswapV3.router, ISwapRouter.abi, provider),
  abi: pancakeswapV3Abi,
};

const IArbitrage = require("../artifacts/contracts/Arbitrage.sol/Arbitrage.json");
const arbitrageContract = new ethers.Contract(config[NETWORK].Contract, IArbitrage.abi, provider);

module.exports = { provider, uniswap, pancakeswap, arbitrageContract };
