import hardhatEthers from '@nomicfoundation/hardhat-ethers';
import hardhatEthersChaiMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import hardhatNetworkHelpers from '@nomicfoundation/hardhat-network-helpers';
import dotenv from 'dotenv';
import { configVariable, defineConfig } from 'hardhat/config';

dotenv.config();

export default defineConfig({
  plugins: [
    hardhatEthers,
    hardhatEthersChaiMatchers,
    hardhatMocha,
    hardhatNetworkHelpers,
  ],
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
    hardhat: {
      type: 'edr-simulated',
      chainType: 'l1',
    },
    baseSepolia: {
      type: 'http',
      chainType: 'op',
      url: configVariable('SOLSLOT_BASE_SEPOLIA_RPC_URL'),
      accounts: [],
      chainId: 84532,
    },
    ethSepolia: {
      type: 'http',
      chainType: 'l1',
      url:
        process.env.SOLSLOT_ETH_SEPOLIA_RPC_URL ||
        'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: [],
      chainId: 11155111,
    },
    baseMainnet: {
      type: 'http',
      chainType: 'op',
      url: process.env.SOLSLOT_BASE_MAINNET_RPC_URL || 'https://mainnet.base.org',
      accounts: [],
      chainId: 8453,
    },
    ethMainnet: {
      type: 'http',
      chainType: 'l1',
      url: configVariable('SOLSLOT_ETH_MAINNET_RPC_URL'),
      accounts: [],
      chainId: 1,
    },
  },
});
