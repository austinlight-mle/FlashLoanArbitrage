const { ethers } = require("ethers");
const ERC20 = require("@openzeppelin/contracts/build/contracts/ERC20.json");
const Big = require("big.js");

const getTokenAndContract = async function (_tokenAAdress, _tokenBAddress, _provider) {
  const tokenAContract = new ethers.Contract(_tokenAAdress, ERC20.abi, _provider);
  const tokenBContract = new ethers.Contract(_tokenBAddress, ERC20.abi, _provider);

  const tokenA = {
    contract: tokenAContract,
    address: _tokenAAdress,
    symbol: await tokenAContract.symbol(),
    decimals: await tokenAContract.decimals(),
  };

  const tokenB = {
    contract: tokenBContract,
    address: _tokenBAddress,
    symbol: await tokenBContract.symbol(),
    decimals: await tokenBContract.decimals(),
  };

  return { tokenA, tokenB };
};

const sortTokens = function (tokenA, tokenB) {
  return tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
}

const getPoolAddress = async function (_factory, _tokenAAddress, _tokenBAddress, _fee) {
  const poolAddress = await _factory.getPool(_tokenAAddress, _tokenBAddress, _fee);
  return poolAddress;
};

const getPoolContract = async function (_exchange, _tokenAAddress, _tokenBAddress, _fee, _provider) {
  const poolAddress = await getPoolAddress(_exchange.factory, _tokenAAddress, _tokenBAddress, _fee);
  const poolContract = new ethers.Contract(poolAddress, _exchange.abi, _provider);
  poolContract.name = _exchange.name;
  return poolContract;
};

// const calculatePrice = async function (_pool, _tokenA, _tokenB) {
//   // Get sqrtPriceX96
//   const { sqrtPriceX96 } = await _pool.slot0();

//   // Get decimalDifference if there is a difference
//   const decimalDifference = Number(Big(_tokenA.decimals - _tokenB.decimals).abs());
//   const conversion = Big(10).pow(decimalDifference);

//   // Calculate rate and price
//   const rate = Big(Big(sqrtPriceX96).div(Big(2 ** 96)) ** Big(2));
//   const price = Big(rate).div(Big(conversion)).toString();

//   if (price == 0) {
//     return Big(rate).mul(Big(conversion)).toString();
//   } else {
//     return price;
//   }
// };

const calculatePrice = async function (_pool, _tokenA, _tokenB) {
  // Get sqrtPriceX96
  const { sqrtPriceX96 } = await _pool.slot0();

  // Convert sqrtPriceX96 to Big
  const sqrtPrice = Big(sqrtPriceX96.toString());

  // Adjust for decimals difference between tokens
  const decimalDifference = Number(Big(_tokenA.decimals - _tokenB.decimals));

  const conversion = Big(10).pow(decimalDifference);

  // Price formula (sqrtPriceX96 / 2^96) ^ 2 * 10^(decimals difference)
  const price = sqrtPrice.div(Big(2).pow(96)).pow(2).mul(conversion);

  return price;
};

const UNISWAP_V3_POOL_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

const getPoolLiquidity = async function (_factory, _tokenA, _tokenB, _fee, _provider) {
  // 1. Get pool address
  const poolAddress = await getPoolAddress(_factory, _tokenA.address, _tokenB.address, _fee);
  if (poolAddress === ethers.ZeroAddress) {
    throw new Error(`❌ No pool found for ${_tokenA.symbol}/${_tokenB.symbol} at fee ${_fee}`);
  }

  // 2. Create pool contract
  const poolContract = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, _provider);

  // 3. Identify token0/token1 in the pool
  const token0Address = await poolContract.token0();
  const token1Address = await poolContract.token1();

  // 4. Get balances of token0/token1
  const token0Balance = await (token0Address.toLowerCase() === _tokenA.address.toLowerCase()
    ? _tokenA.contract.balanceOf(poolAddress)
    : _tokenB.contract.balanceOf(poolAddress));

  const token1Balance = await (token1Address.toLowerCase() === _tokenA.address.toLowerCase()
    ? _tokenA.contract.balanceOf(poolAddress)
    : _tokenB.contract.balanceOf(poolAddress));

  // 5. Return balances aligned to _tokenA / _tokenB order
  const tokenABalance = token0Address.toLowerCase() === _tokenA.address.toLowerCase()
    ? token0Balance
    : token1Balance;

  const tokenBBalance = token0Address.toLowerCase() === _tokenB.address.toLowerCase()
    ? token0Balance
    : token1Balance;

  return [tokenABalance, tokenBBalance];
};

// const getPoolLiquidity = async function (_factory, _tokenA, _tokenB, _fee, _provider) {
//   const poolAddress = await getPoolAddress(_factory, _tokenA.address, _tokenB.address, _fee);

//   const tokenABalance = await _tokenA.contract.balanceOf(poolAddress);
//   const tokenBBalance = await _tokenB.contract.balanceOf(poolAddress);

//   return [tokenABalance, tokenBBalance];
// };

module.exports = { getTokenAndContract, getPoolAddress, getPoolContract, calculatePrice, getPoolLiquidity, sortTokens };
