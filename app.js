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

const DEX_A = uniswap;
const DEX_B = pancakeswap;

const NETWORK = config.PROJECT_SETTINGS.network;
const TOKENS = config[NETWORK].tokens;

const TOKEN_A = TOKENS[config.PROJECT_SETTINGS.tokens[0]];
const TOKEN_B = TOKENS[config.PROJECT_SETTINGS.tokens[1]];

const BUY_FEE = config.PROJECT_SETTINGS.BUY_FEE;
const SELL_FEE = config.PROJECT_SETTINGS.SELL_FEE;

const UNITS = config.PROJECT_SETTINGS.PRICE_UNITS;
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

  console.log("Waiting for swap event...\n");
};

let isExecuting = false;

const eventHandler = async (_poolA, _poolB, _tokenA, _tokenB) => {
  if (!isExecuting) {
    isExecuting = true;

    const priceDifference = await checkPrice([_poolA, _poolB], _tokenA, _tokenB);
    const isAToB = determineDirection(priceDifference);

    if (!isAToB) {
      console.log(`No Arbitrage Currently Available\n`);
      console.log(`---------------------------------------------------------------------------\n`);
      isExecuting = false;
      return;
    }

    const { isProfitable, amount } = await determineProfitability(isAToB, _tokenA, _tokenB);

    if (!isProfitable) {
      console.log(`This is not profitable\n`);
      console.log(`---------------------------------------------------------------------------\n`);
      isExecuting = false;
      return;
    }

    const receipt = await executeTrade(isAToB, _tokenA, _tokenB, amount);

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
  console.log(`${_pools[0].name}\t | ${_tokenB.symbol}/${_tokenA.symbol}\t | ${priceA}`);
  console.log(`${_pools[1].name}\t | ${_tokenB.symbol}/${_tokenA.symbol}\t | ${priceB}\n`);
  console.log(`Percentage Difference: ${priceDifference}%\n`);

  return priceDifference;
};

const determineDirection = (_priceDifference) => {
  console.log(`Determining Direction...`);

  if (_priceDifference >= PRICE_DIFFERENCE) {
    console.log(`Potential Arbitrage Direction:\n`);
    console.log(`Buy\t -->\t ${DEX_A.name}`);
    console.log(`Sell\t -->\t ${DEX_B.name}\n`);
    return true;
  } else if (_priceDifference <= -PRICE_DIFFERENCE) {
    console.log(`Potential Arbitrage Direction:\n`);
    console.log(`Buy\t -->\t ${DEX_B.name}`);
    console.log(`Sell\t -->\t ${DEX_A.name}\n`);
    return false;
  } else {
    return null;
  }
};

const determineProfitability = async (isAToB, _tokenA, _tokenB) => {
  console.log(`Determining Profitability...`);

  try {
    const poolA = isAToB ? DEX_A : DEX_B;
    const poolB = isAToB ? DEX_B : DEX_A;
    const buyFeePPM = isAToB ? BUY_FEE : SELL_FEE;
    const sellFeePPM = isAToB ? SELL_FEE : BUY_FEE;

    const buyFee = buyFeePPM / 1_000_000;
    const sellFee = sellFeePPM / 1_000_000;

    const MAX_SLIPPAGE = 0.005;

    const netMultiplier = (1 - buyFee) * (1 + PRICE_DIFFERENCE / 100) * (1 - sellFee);

    if (netMultiplier <= 1) {
      return { isProfitable: false, amount: 0 };
    }

    const liquidityA = await getPoolLiquidity(poolA.factory, _tokenA, _tokenB, buyFeePPM, provider);
    const liquidityB = await getPoolLiquidity(poolB.factory, _tokenA, _tokenB, sellFeePPM, provider);

    // Choose correct token reserve depending on trade direction (convert from wei to Big)
    const reserveA_tokenB = isAToB 
      ? Big(ethers.formatUnits(liquidityA[1], _tokenB.decimals))
      : Big(ethers.formatUnits(liquidityA[0], _tokenA.decimals));
    const reserveB_tokenB = isAToB 
      ? Big(ethers.formatUnits(liquidityB[1], _tokenB.decimals))
      : Big(ethers.formatUnits(liquidityB[0], _tokenA.decimals));

    // ==== 3. Calculate safe minAmount based on liquidity & slippage ====
    const safeFromA = reserveA_tokenB.mul(MAX_SLIPPAGE); 
    const safeFromB = reserveB_tokenB.mul(MAX_SLIPPAGE);
    const minAmount = safeFromA.lt(safeFromB) ? safeFromA : safeFromB;

    console.log(`Minimum Amount of ${_tokenB.symbol} to buy: ${minAmount.toFixed(4)}\n`);

    // Figure out how much token A needed for minAmount of token B...
    const quoteExactOutputSingleParams = {
      tokenIn: _tokenA.address,
      tokenOut: _tokenB.address,
      fee: buyFeePPM, // Use PPM value, not decimal
      amount: ethers.parseUnits(minAmount.toFixed(_tokenB.decimals), _tokenB.decimals),
      sqrtPriceLimitX96: 0,
    };

    const [tokenANeeded] = await poolA.quoter.quoteExactOutputSingle.staticCall(
      quoteExactOutputSingleParams
    );

    // Figure out how much token A returned after swapping minAmount of token B
    const quoteExactInputSingleParams = {
      tokenIn: _tokenB.address,
      tokenOut: _tokenA.address,
      fee: sellFeePPM, // Use PPM value, not decimal
      amountIn: ethers.parseUnits(minAmount.toFixed(_tokenB.decimals), _tokenB.decimals),
      sqrtPriceLimitX96: 0,
    };

    const [tokenAReturned] = await poolB.quoter.quoteExactInputSingle.staticCall(
      quoteExactInputSingleParams
    );

    const amountIn = ethers.formatUnits(tokenANeeded, _tokenA.decimals);
    const amountOut = ethers.formatUnits(tokenAReturned, _tokenA.decimals);

    console.log(
      `Estimated amount of ${_tokenA.symbol} needed to buy ${_tokenB.symbol} on ${poolA.name}: ${amountIn}`
    );
    console.log(
      `Estimated amount of ${_tokenA.symbol} returned after swapping ${_tokenB.symbol} on ${poolB.name}: ${amountOut}\n`
    );

    if (Number(amountOut) < Number(amountIn)) {
      throw new Error("Not enough to pay back flash loan");
    }

    return { isProfitable: true, amount: ethers.parseUnits(amountIn, _tokenA.decimals) };
  } catch (error) {
    console.log(error);
    console.log("");
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
