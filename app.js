const { ethers } = require("ethers");

require("dotenv/config");
require("./server/index.js");

const Big = require("big.js");
const config = require("./config/config.json");

const {
  getTokenAndContract,
  getPoolContract,
  calculatePrice,
  getPoolLiquidity,
} = require("./utils/helper.js");

const { provider, uniswap, pancakeswap, arbitrageContract } = require("./utils/initialization.js");

const NETWORK = config.PROJECT_SETTINGS.network;
const TOKENS = config[NETWORK].tokens;

const TOKEN_A = TOKENS[config.PROJECT_SETTINGS.tokens[0]];
const TOKEN_B = TOKENS[config.PROJECT_SETTINGS.tokens[1]];

const POOL_FEE = config[NETWORK].tokens.POOL_FEE;

const UNITS = config.PROJECT_SETTINGS.PRICE_UNITS;
const PRICE_DIFFERENCE = config.PROJECT_SETTINGS.PRICE_DIFFERENCE;
const GAS_LIMIT = config.PROJECT_SETTINGS.GAS_LIMIT;
const GAS_PRICE = config.PROJECT_SETTINGS.GAS_PRICE;

const main = async () => {
  console.log("Starting Flash Loan Arbitrage Bot...");

  const { tokenA, tokenB } = await getTokenAndContract(TOKEN_A, TOKEN_B, provider);
  const poolA = await getPoolContract(uniswap, tokenA.address, tokenB.address, POOL_FEE, provider);
  const poolB = await getPoolContract(pancakeswap, tokenA.address, tokenB.address, POOL_FEE, provider);

  console.log(`---------------------------------------------------------------------------\n`);
  console.log(`Token Pair: ${tokenA.symbol}/${tokenB.symbol}`);
  console.log(`${poolA.name} Pool Address:\t ${await poolA.getAddress()}`);
  console.log(`${poolB.name} Pool Address:\t ${await poolB.getAddress()}\n`);

  poolA.on("Swap", () => eventHandler(poolA, poolB, tokenA, tokenB));
  poolB.on("Swap", () => eventHandler(poolA, poolB, tokenA, tokenB));

  console.log("Waiting for swap event...\n");
};

let isExecuting = false;

const eventHandler = async (_poolA, _poolB, _tokenA, _tokenB) => {
  if (!isExecuting) {
    isExecuting = true;

    const priceDifference = await checkPrice([_poolA, _poolB], _tokenA, _tokenB);
    const exchangePath = await determineDirection([uniswap, pancakeswap], priceDifference);

    if (!exchangePath) {
      console.log(`No Arbitrage Currently Available\n`);
      console.log(`-----------------------------------------\n`);
      isExecuting = false;
      return;
    }

    const { isProfitable, amount } = await determineProfitability(exchangePath, _tokenA, _tokenB);

    if (!isProfitable) {
      console.log(`No Arbitrage Currently Available\n`);
      console.log(`-----------------------------------------\n`);
      isExecuting = false;
      return;
    }

    const receipt = await executeTrade(exchangePath, _tokenA, _tokenB, amount);

    isExecuting = false;

    console.log("\nWaiting for swap event...\n");
  }
};

const checkPrice = async (_pools, _tokenA, _tokenB) => {
  console.log(`Swap Detected, Checking Price...\n`);

  const currentBlock = await provider.getBlockNumber();

  const [priceA, priceB] = await Promise.all([
    calculatePrice(_pools[0], _tokenA, _tokenB),
    calculatePrice(_pools[1], _tokenA, _tokenB),
  ]);

  const priceDifference = priceA.minus(priceB).div(priceB).times(100).toFixed(2);

  console.log(`Current Block: ${currentBlock}`);
  console.log(`-----------------------------------------`);
  console.log(`${_pools[0].name}\t | ${_tokenB.symbol}/${_tokenA.symbol}\t | ${priceA}`);
  console.log(`${_pools[1].name}\t | ${_tokenB.symbol}/${_tokenA.symbol}\t | ${priceB}\n`);
  console.log(`Percentage Difference: ${priceDifference}%\n`);

  return priceDifference;
};

const determineDirection = async (_pools, _priceDifference) => {
  console.log(`Determining Direction...\n`);

  if (_priceDifference >= PRICE_DIFFERENCE) {
    console.log(`Potential Arbitrage Direction:\n`);
    console.log(`Buy\t -->\t ${_pools[0].name}`);
    console.log(`Sell\t -->\t ${_pools[1].name}\n`);
    return [_pools[0], _pools[1]];
  } else if (_priceDifference <= -PRICE_DIFFERENCE) {
    console.log(`Potential Arbitrage Direction:\n`);
    console.log(`Buy\t -->\t ${_pools[1].name}`);
    console.log(`Sell\t -->\t ${_pools[0].name}\n`);
    return [_pools[1], _pools[0]];
  } else {
    return null;
  }
};

const determineProfitability = async (_exchangePath, _tokenA, _tokenB) => {
  console.log(`Determining Profitability...\n`);

  // This is where you can customize your conditions on whether a profitable trade is possible...

  /**
   * The helper file has quite a few functions that come in handy
   * for performing specifc tasks.
   */

  try {
    // Fetch liquidity off of the exchange to buy token1 from
    const liquidity = await getPoolLiquidity(_exchangePath[0].factory, _tokenA, _tokenB, POOL_FEE, provider);

    // An example of using a percentage of the liquidity
    // BigInt doesn't like decimals, so we use Big.js here
    const percentage = Big(0.1);
    const minAmount = Big(liquidity[1]).mul(percentage);

    // Figure out how much tokenA needed for X amount of tokenB...
    const quoteExactOutputSingleParams = {
      tokenIn: _tokenA.address,
      tokenOut: _tokenB.address,
      fee: POOL_FEE,
      amount: BigInt(minAmount.round().toFixed(0)),
      sqrtPriceLimitX96: 0,
    };

    const [tokenANeeded] = await _exchangePath[0].quoter.quoteExactOutputSingle.staticCall(
      quoteExactOutputSingleParams
    );

    // Figure out how much tokenA returned after swapping X amount of tokenB
    const quoteExactInputSingleParams = {
      tokenIn: _tokenB.address,
      tokenOut: _tokenA.address,
      fee: POOL_FEE,
      amountIn: BigInt(minAmount.round().toFixed(0)),
      sqrtPriceLimitX96: 0,
    };

    const [tokenAReturned] = await _exchangePath[1].quoter.quoteExactInputSingle.staticCall(
      quoteExactInputSingleParams
    );

    const amountIn = ethers.formatUnits(tokenANeeded, _tokenA.decimals);
    const amountOut = ethers.formatUnits(tokenAReturned, _tokenA.decimals);

    console.log(
      `Estimated amount of ${_tokenA.symbol} needed to buy ${_tokenB.symbol} on ${_exchangePath[0].name}: ${amountIn}`
    );
    console.log(
      `Estimated amount of ${_tokenA.symbol} returned after swapping ${_tokenB.symbol} on ${_exchangePath[1].name}: ${amountOut}\n`
    );

    const amountDifference = amountOut - amountIn;
    const estimatedGasCost = GAS_LIMIT * GAS_PRICE;

    // Fetch account
    const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const ethBalanceBefore = ethers.formatUnits(await provider.getBalance(account.address), 18);
    const ethBalanceAfter = ethBalanceBefore - estimatedGasCost;

    const tokenABalanceBefore = Number(
      ethers.formatUnits(await _tokenA.contract.balanceOf(account.address), _tokenA.decimals)
    );
    const tokenABalanceAfter = amountDifference + tokenABalanceBefore;
    const tokenABalanceDifference = tokenABalanceAfter - tokenABalanceBefore;

    const data = {
      "ETH Balance Before": ethBalanceBefore,
      "ETH Balance After": ethBalanceAfter,
      "ETH Spent (gas)": estimatedGasCost,
      "-": {},
      [`${_tokenA.symbol} Balance BEFORE`]: tokenABalanceBefore,
      [`${_tokenA.symbol} Balance AFTER`]: tokenABalanceAfter,
      [`${_tokenA.symbol} Gained/Lost`]: tokenABalanceDifference,
      "-": {},
      "Total Gained/Lost": tokenABalanceDifference - estimatedGasCost,
    };

    console.table(data);
    console.log();

    // Setup conditions...

    if (Number(amountOut) < Number(amountIn)) {
      throw new Error("Not enough to pay back flash loan");
    }

    if (Number(ethBalanceAfter) < 0) {
      throw new Error("Not enough ETH for gas fee");
    }

    return { isProfitable: true, amount: ethers.parseUnits(amountIn, _tokenA.decimals) };
  } catch (error) {
    console.log(error);
    console.log("");
    return { isProfitable: false, amount: 0 };
  }
};

const executeTrade = async (_exchangePath, _tokenA, _tokenB, _amount) => {
  console.log(`Attempting Arbitrage...\n`);

  const routerPath = [await _exchangePath[0].router.getAddress(), await _exchangePath[1].router.getAddress()];

  const tokenPath = [_tokenA.address, _tokenB.address];

  // Create Signer
  const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // Fetch token balances before
  const tokenBalanceBefore = await _tokenA.contract.balanceOf(account.address);
  const ethBalanceBefore = await provider.getBalance(account.address);

  if (config.PROJECT_SETTINGS.isDeployed) {
    const transaction = await arbitrageContract
      .connect(account)
      .executeTrade(routerPath, tokenPath, POOL_FEE, _amount);

    const receipt = await transaction.wait(0);
  }

  console.log(`Trade Complete:\n`);

  // Fetch token balances after
  const tokenBalanceAfter = await _tokenA.contract.balanceOf(account.address);
  const ethBalanceAfter = await provider.getBalance(account.address);

  const tokenBalanceDifference = tokenBalanceAfter - tokenBalanceBefore;
  const ethBalanceDifference = ethBalanceBefore - ethBalanceAfter;

  const data = {
    "ETH Balance Before": ethers.formatUnits(ethBalanceBefore, 18),
    "ETH Balance After": ethers.formatUnits(ethBalanceAfter, 18),
    "ETH Spent (gas)": ethers.formatUnits(ethBalanceDifference.toString(), 18),
    "-": {},
    [`${_tokenA.symbol} Balance BEFORE`]: ethers.formatUnits(tokenBalanceBefore, _tokenA.decimals),
    [`${_tokenA.symbol} Balance AFTER`]: ethers.formatUnits(tokenBalanceAfter, _tokenA.decimals),
    [`${_tokenA.symbol} Gained/Lost`]: ethers.formatUnits(
      tokenBalanceDifference.toString(),
      _tokenA.decimals
    ),
    "-": {},
    "Total Gained/Lost": `${ethers.formatUnits(
      (tokenBalanceDifference - ethBalanceDifference).toString(),
      _tokenA.decimals
    )}`,
  };

  console.table(data);
};

main().catch((error) => {
  console.error("Error in Flash Loan Arbitrage Bot:", error);
  process.exit(1);
});
