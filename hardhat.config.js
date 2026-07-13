require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: 'cancun',
    },
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url: process.env.SOLSLOT_BASE_SEPOLIA_RPC_URL || '',
      accounts: process.env.SOLSLOT_DEPLOYER_PRIVATE_KEY
        ? [process.env.SOLSLOT_DEPLOYER_PRIVATE_KEY]
        : [],
      chainId: 84532,
    },
    ethSepolia: {
      url:
        process.env.SOLSLOT_ETH_SEPOLIA_RPC_URL ||
        'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: process.env.SOLSLOT_DEPLOYER_PRIVATE_KEY
        ? [process.env.SOLSLOT_DEPLOYER_PRIVATE_KEY]
        : [],
      chainId: 11155111,
    },
    baseMainnet: {
      url: process.env.SOLSLOT_BASE_MAINNET_RPC_URL || 'https://mainnet.base.org',
      accounts: process.env.SOLSLOT_DEPLOYER_PRIVATE_KEY
        ? [process.env.SOLSLOT_DEPLOYER_PRIVATE_KEY]
        : [],
      chainId: 8453,
    },
    ethMainnet: {
      url: process.env.SOLSLOT_ETH_MAINNET_RPC_URL || '',
      accounts: process.env.SOLSLOT_DEPLOYER_PRIVATE_KEY
        ? [process.env.SOLSLOT_DEPLOYER_PRIVATE_KEY]
        : [],
      chainId: 1,
    },
  },
};
