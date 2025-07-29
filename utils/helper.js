const { ethers } = require("ethers");
const ERC20 = require("@openzeppelin/contracts/build/contracts/ERC20.json");

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

module.exports = { getTokenAndContract };
