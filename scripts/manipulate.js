const hre = require("hardhat");
const config = require("../config/config.json");

// -- IMPORT HELPER FUNCTIONS & CONFIG -- //
const { getTokenAndContract, getPoolContract, calculatePrice } = require("../utils/helper.js");
const { provider, uniswap, pancakeswap } = require("../utils/initialization.js");

// -- CONFIGURE VALUES HERE -- //
const EXCHANGE_TO_USE = pancakeswap;

const UNLOCKED_ACCOUNT = "0xB38e8c17e38363aF6EbdCb3dAE12e0243582891D"; // Account to impersonate
const AMOUNT = "100000"; // Amount of tokens to swap

async function main() {
  // Fetch contracts
  const { tokenA: ARB, tokenB: WETH } = await getTokenAndContract(
    config.tokens.ARB,
    config.tokens.WETH,
    provider
  );

  const pool = await getPoolContract(
    EXCHANGE_TO_USE,
    ARB.address,
    WETH.address,
    config.tokens.POOL_FEE,
    provider
  );

  // Fetch price of SHIB/WETH before we execute the swap
  const priceBefore = await calculatePrice(pool, ARB, WETH);

  // Send ETH to account to ensure they have enough ETH to create the transaction
  await (
    await hre.ethers.getSigners()
  )[0].sendTransaction({
    to: UNLOCKED_ACCOUNT,
    value: hre.ethers.parseUnits("1", 18),
  });

  await manipulatePrice([ARB, WETH]);

  // Fetch price of SHIB/WETH after the swap
  const priceAfter = await calculatePrice(pool, ARB, WETH);

  const data = {
    "Price Before": `1 ${WETH.symbol} = ${Number(priceBefore).toFixed(0)} ${ARB.symbol}`,
    "Price After": `1 ${WETH.symbol} = ${Number(priceAfter).toFixed(0)} ${ARB.symbol}`,
  };

  console.table(data);
}

async function manipulatePrice(_path) {
  console.log(`\nBeginning Swap...\n`);

  console.log(`Input Token: ${_path[0].symbol}`);
  console.log(`Output Token: ${_path[1].symbol}\n`);

  const fee = config.tokens.POOL_FEE;
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
