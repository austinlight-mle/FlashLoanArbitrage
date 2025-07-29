require("dotenv/config");
const { ethers } = require("ethers");

const config = require("../config/config.json");

let provider;

if (config.PROJECT_SETTINGS.isLocal) {
  provider = new ethers.JsonRpcProvider("http://localhost:8545");
} else {
  provider = new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);
}

module.exports = { provider };
