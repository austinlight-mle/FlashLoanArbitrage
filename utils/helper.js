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

  return price.toString();
};

const getPoolLiquidity = async function (_factory, _tokenA, _tokenB, _fee, _provider) {
  const poolAddress = await getPoolAddress(_factory, _tokenA.address, _tokenB.address, _fee);

  const tokenABalance = await _tokenA.contract.balanceOf(poolAddress);
  const tokenBBalance = await _tokenB.contract.balanceOf(poolAddress);

  return [tokenABalance, tokenBBalance];
};

module.exports = { getTokenAndContract, getPoolAddress, getPoolContract, calculatePrice, getPoolLiquidity };
