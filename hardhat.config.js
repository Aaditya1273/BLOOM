require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ quiet: true });
require("./scripts/lib/ethers-fetch");

// Keys are only read from the environment. Never hardcode keys in this repository.
const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      viaIR: true,
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      // allows the mainnet preflight to dry-run the deployment on an in-process fork of Robinhood Chain
      chains: {
        4663: { hardforkHistory: { cancun: 0 } },
        46630: { hardforkHistory: { cancun: 0 } },
      },
    },
    robinhoodTestnet: {
      url: process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts,
    },
    robinhoodMainnet: {
      url: process.env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts,
    },
  },
  mocha: { timeout: 120000 },
};
