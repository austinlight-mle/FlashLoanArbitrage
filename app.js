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
  sortTokens,
} = require("./utils/helper.js");

const { provider, uniswap, pancakeswap, arbitrageContract } = require("./utils/initialization.js");

const DEX_A = uniswap;
const DEX_B = pancakeswap;

const NETWORK = config.PROJECT_SETTINGS.network;
const TOKENS = config[NETWORK].tokens;

const [TOKEN_A, TOKEN_B] = sortTokens(
  TOKENS[config.PROJECT_SETTINGS.tokens[0]],
  TOKENS[config.PROJECT_SETTINGS.tokens[1]]
);

const BUY_FEE = config.PROJECT_SETTINGS.BUY_FEE;
const SELL_FEE = config.PROJECT_SETTINGS.SELL_FEE;

const PRICE_DIFFERENCE = config.PROJECT_SETTINGS.PRICE_DIFFERENCE;
const GAS_LIMIT = config.PROJECT_SETTINGS.GAS_LIMIT;
const GAS_PRICE = config.PROJECT_SETTINGS.GAS_PRICE;

const main = async () => {
  console.log("Starting Flash Loan Arbitrage Bot...");

  const { tokenA, tokenB } = await getTokenAndContract(TOKEN_A, TOKEN_B, provider);
  const poolA = await getPoolContract(DEX_A, tokenA.address, tokenB.address, BUY_FEE, provider);
  const poolB = await getPoolContract(DEX_B, tokenA.address, tokenB.address, SELL_FEE, provider);

  console.log(`---------------------------------------------------------------------------\n`);
  console.log(`Token Pair: ${tokenA.symbol}/${tokenB.symbol}`);
  console.log(`${poolA.name} Pool Address:\t ${await poolA.getAddress()}`);
  console.log(`${poolB.name} Pool Address:\t ${await poolB.getAddress()}\n`);

  poolA.on("Swap", () => eventHandler(poolA, poolB, tokenA, tokenB));
  poolB.on("Swap", () => eventHandler(poolA, poolB, tokenA, tokenB));

  console.log("Waiting for swap event...");
};

let isExecuting = false;

const eventHandler = async (_poolA, _poolB, _tokenA, _tokenB) => {
  if (!isExecuting) {
    isExecuting = true;

    const priceData = await checkPrice([_poolA, _poolB], _tokenA, _tokenB);
    console.log(`Percentage Difference: ${priceData.priceDifference}%\n`);

    if (Math.abs(priceData.priceDifference) >= PRICE_DIFFERENCE) {
      console.log(`Arbitrage Opportunity Detected:`);
      console.log(`${_poolA.name}\t | ${_tokenA.symbol}/${_tokenB.symbol}\t | ${priceData.priceA}`);
      console.log(`${_poolB.name}\t | ${_tokenA.symbol}/${_tokenB.symbol}\t | ${priceData.priceB}\n`);

      const isAToB = determineDirection(priceData.priceDifference);
      const { isProfitable, amount } = await determineProfitability(isAToB, _tokenA, _tokenB);

      if (!isProfitable) {
        console.log(`This is not profitable\n`);
        console.log(`---------------------------------------------------------------------------\n`);
        isExecuting = false;
        return;
      }

      const receipt = await executeTrade(isAToB, _tokenA, _tokenB, amount);
      console.log(`Trade executed successfully:\n`);
    }

    isExecuting = false;

    console.log("Waiting for swap event...");
  }
};

const checkPrice = async (_pools, _tokenA, _tokenB) => {
  console.log(`Swap Detected, Checking Price...`);

  const [priceA, priceB] = await Promise.all([
    calculatePrice(_pools[0], _tokenA, _tokenB),
    calculatePrice(_pools[1], _tokenA, _tokenB),
  ]);

  const priceDifference = priceB.minus(priceA).div(priceA).times(100).toFixed(2);

  return {
    priceDifference,
    priceA,
    priceB,
  };
};

const determineDirection = (_priceDifference) => {
  console.log(`Determining Direction...`);

  if (_priceDifference <= -PRICE_DIFFERENCE) {
    console.log(`Potential Arbitrage Direction:\n`);
    console.log(`Buy\t -->\t ${DEX_A.name}`);
    console.log(`Sell\t -->\t ${DEX_B.name}\n`);
    return true;
  } else if (_priceDifference >= PRICE_DIFFERENCE) {
    console.log(`Potential Arbitrage Direction:\n`);
    console.log(`Buy\t -->\t ${DEX_B.name}`);
    console.log(`Sell\t -->\t ${DEX_A.name}\n`);
    return false;
  }
};

const determineProfitability = async (isAToB, _tokenA, _tokenB) => {
  console.log(`Determining Profitability...`);

  try {
    const poolA = isAToB ? DEX_A : DEX_B;
    const poolB = isAToB ? DEX_B : DEX_A;
    const buyFee = isAToB ? BUY_FEE : SELL_FEE;
    const sellFee = isAToB ? SELL_FEE : BUY_FEE;

    const liquidityA = await getPoolLiquidity(poolA.factory, _tokenA, _tokenB, buyFee, provider);
    const liquidityB = await getPoolLiquidity(poolB.factory, _tokenA, _tokenB, sellFee, provider);

    console.log(`Amount of ${_tokenB.symbol} in ${poolA.name}: ${liquidityA[1]}`);

    const percentage = Big(0.05);
    const minAmount = Big((liquidityA[1] < liquidityB[1] ? liquidityA[1] : liquidityB[1]).toString()).mul(
      percentage
    );

    // Figure out how much tokenA needed for X amount of tokenB...
    const quoteExactOutputSingleParams = {
      tokenIn: _tokenA.address,
      tokenOut: _tokenB.address,
      fee: buyFee,
      amount: BigInt(minAmount.round().toFixed(0)),
      sqrtPriceLimitX96: 0,
    };

    const [tokenANeeded] = await poolA.quoter.quoteExactOutputSingle.staticCall(quoteExactOutputSingleParams);

    const amountIn = ethers.formatUnits(tokenANeeded, _tokenA.decimals);
    return { isProfitable: true, amount: ethers.parseUnits(amountIn, _tokenA.decimals) };

    // Figure out how much tokenA returned after swapping X amount of tokenB
    const quoteExactInputSingleParams = {
      tokenIn: _tokenB.address,
      tokenOut: _tokenA.address,
      fee: sellFee,
      amountIn: BigInt(minAmount.round().toFixed(0)),
      sqrtPriceLimitX96: 0,
    };

    const [tokenAReturned] = await poolB.quoter.quoteExactInputSingle.staticCall(quoteExactInputSingleParams);

    // const amountIn = ethers.formatUnits(tokenANeeded, _tokenA.decimals);
    const amountOut = ethers.formatUnits(tokenAReturned, _tokenA.decimals);

    console.log(
      `Estimated amount of ${_tokenA.symbol} needed to buy ${_tokenB.symbol} on ${poolA.name}: ${amountIn}`
    );
    console.log(
      `Estimated amount of ${_tokenA.symbol} returned after swapping ${_tokenB.symbol} on ${poolB.name}: ${amountOut}\n`
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
    return { isProfitable: false, amount: 0 };
  }
};

const executeTrade = async (isAToB, _tokenA, _tokenB, _amount) => {
  console.log(`Attempting Arbitrage...`);

  const poolA = isAToB ? DEX_A : DEX_B;
  const poolB = isAToB ? DEX_B : DEX_A;
  const buyFee = isAToB ? BUY_FEE : SELL_FEE;
  const sellFee = isAToB ? SELL_FEE : BUY_FEE;

  const routerPath = [await poolA.router.getAddress(), await poolB.router.getAddress()];
  const tokenPath = [_tokenA.address, _tokenB.address];
  const feePath = [buyFee, sellFee];

  // Create Signer
  const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // Fetch token balances before
  const tokenBalanceBefore = await _tokenA.contract.balanceOf(account.address);
  const ethBalanceBefore = await provider.getBalance(account.address);

  if (config.PROJECT_SETTINGS.isDeployed) {
    const transaction = await arbitrageContract
      .connect(account)
      .executeTrade(routerPath, tokenPath, feePath, _amount);

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
