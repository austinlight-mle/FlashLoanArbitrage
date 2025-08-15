const hre = require("hardhat");
const config = require("../config/config.json");

// -- IMPORT HELPER FUNCTIONS & CONFIG -- //
const { getTokenAndContract, getPoolContract, calculatePrice } = require("../utils/helper.js");
const { provider, uniswap, pancakeswap } = require("../utils/initialization.js");

// -- CONFIGURE VALUES HERE -- //
const EXCHANGE_TO_USE = uniswap;

const UNLOCKED_ACCOUNT = "0x0044f127511830bf4483db87adde07e843e2c66b"; // Account to impersonate
const AMOUNT = "100000"; // Amount of tokens to swap

const TOKEN_A = config.ethereum.tokens.WETH;
const TOKEN_B = config.ethereum.tokens.USDC;

const POOL_FEE = config.PROJECT_SETTINGS.BUY_FEE;

async function main() {
  // Fetch contracts
  const { tokenA: WETH, tokenB: USDC } = await getTokenAndContract(TOKEN_A, TOKEN_B, provider);

  const pool = await getPoolContract(EXCHANGE_TO_USE, WETH.address, USDC.address, POOL_FEE, provider);

  // Fetch price of USDC/WETH before we execute the swap
  const priceBefore = await calculatePrice(pool, WETH, USDC);

  // Send ETH to account to ensure they have enough ETH to create the transaction
  await (
    await hre.ethers.getSigners()
  )[0].sendTransaction({
    to: UNLOCKED_ACCOUNT,
    value: hre.ethers.parseUnits("1", 18),
  });

  await manipulatePrice([WETH, USDC]);

  // Fetch price of WETH/USDC after the swap
  const priceAfter = await calculatePrice(pool, WETH, USDC);

  const data = {
    "Price Before": `1 ${WETH.symbol} = ${Number(priceBefore).toFixed(0)} ${USDC.symbol}`,
    "Price After": `1 ${WETH.symbol} = ${Number(priceAfter).toFixed(0)} ${USDC.symbol}`,
  };

  console.table(data);
}

async function manipulatePrice(_path) {
  console.log(`\nBeginning Swap...\n`);

  console.log(`Input Token: ${_path[0].symbol}`);
  console.log(`Output Token: ${_path[1].symbol}\n`);

  const fee = POOL_FEE;
  const amount = hre.ethers.parseUnits(AMOUNT, _path[0].decimals);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [UNLOCKED_ACCOUNT],
  });

  const signer = await hre.ethers.getSigner(UNLOCKED_ACCOUNT);

  const approval = await _path[0].contract
    .connect(signer)
    .approve(await EXCHANGE_TO_USE.router.getAddress(), amount, { gasLimit: 125000 });
  await approval.wait();

  const ExactInputSingleParams = {
    tokenIn: _path[0].address,
    tokenOut: _path[1].address,
    fee: fee,
    recipient: signer.address,
    deadline: deadline,
    amountIn: amount,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
  };

  const swap = await EXCHANGE_TO_USE.router.connect(signer).exactInputSingle(ExactInputSingleParams);
  await swap.wait();

  console.log(`Swap Complete!\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
