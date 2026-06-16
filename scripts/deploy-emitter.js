/**
 * Deploy PopulisZkPassportAttestationEmitter to Base Sepolia (or local Hardhat).
 *
 * Usage:
 *   # Local (Hardhat node — uses MockZkPassportVerifierAdapter):
 *   npx hardhat run scripts/deploy-emitter.js --network hardhat
 *
 *   # Base Sepolia with real ZkPassportRealVerifierAdapter (alpha testnet):
 *   ZKPASSPORT_DOMAIN=populis.app ZKPASSPORT_DEV_MODE=true \
 *     npx hardhat run scripts/deploy-emitter.js --network baseSepolia
 *
 *   # Base Sepolia with a pre-deployed adapter at a known address:
 *   ZKPASSPORT_VERIFIER_ADDR=0x... \
 *     npx hardhat run scripts/deploy-emitter.js --network baseSepolia
 *
 * Environment variables (add to populis_evm/.env):
 *   BASE_SEPOLIA_RPC_URL      — Base Sepolia JSON-RPC endpoint
 *   DEPLOYER_PRIVATE_KEY      — 0x-prefixed deployer private key
 *   ZKPASSPORT_DOMAIN         — domain passed to ZkPassportRealVerifierAdapter
 *                               (e.g. "populis.app"); triggers real adapter deploy
 *   ZKPASSPORT_DEV_MODE       — "true" to accept mock ZKR passports (alpha testnet)
 *   ZKPASSPORT_VERIFIER_ADDR  — (optional) skip adapter deploy, use this address
 *   BRIDGE_POLICY_HASH        — (optional) 0x-prefixed 32-byte bridge policy hash;
 *                               if omitted, uses the pinned testnet11 value below
 *
 * Testnet11 bridge policy hash (computed from the pinned BLS validator pubkey):
 *   0xc87f45cd23d052c88256de8823a4a01f40da4e2066156f48f3b3dfc0a50350d7
 *
 * Validator BLS pubkey (48 bytes, hex):
 *   a8f9b0c1f992c49210fc726fc610885b966f84747126753659c6c3f8ae5bf3baf5b6e1a399fc8a749daf45dd74efac4c
 *
 * zkPassport root verifier (deterministic address, all supported chains):
 *   0x1D000001000EFD9a6371f4d90bB8920D5431c0D8
 */

'use strict';

const { ethers, network } = require('hardhat');

const TESTNET11_BRIDGE_POLICY_HASH =
  '0xc87f45cd23d052c88256de8823a4a01f40da4e2066156f48f3b3dfc0a50350d7';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network      : ${network.name}`);
  console.log(`Deployer     : ${deployer.address}`);
  console.log(`Balance      : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  const bridgePolicyHash = process.env.BRIDGE_POLICY_HASH || TESTNET11_BRIDGE_POLICY_HASH;
  console.log(`Bridge policy: ${bridgePolicyHash}`);

  let verifierAddress = process.env.ZKPASSPORT_VERIFIER_ADDR;
  const zkpDomain = process.env.ZKPASSPORT_DOMAIN;
  const zkpDevMode = process.env.ZKPASSPORT_DEV_MODE === 'true';

  if (!verifierAddress && zkpDomain) {
    console.log(`\nZKPASSPORT_DOMAIN=${zkpDomain}, devMode=${zkpDevMode} — deploying ZkPassportRealVerifierAdapter…`);
    const RealAdapterFactory = await ethers.getContractFactory('ZkPassportRealVerifierAdapter');
    const realAdapter = await RealAdapterFactory.deploy(zkpDomain, zkpDevMode);
    await realAdapter.waitForDeployment();
    verifierAddress = await realAdapter.getAddress();
    console.log(`ZkPassportRealVerifierAdapter : ${verifierAddress}`);
    console.log(`  domain   : ${zkpDomain} (constructor arg)`);
    console.log(`  devMode  : ${zkpDevMode} (constructor arg)`);
    console.log(`  rootVerifier: 0x1D000001000EFD9a6371f4d90bB8920D5431c0D8 (hardcoded)`);
  } else if (!verifierAddress) {
    console.log('\nNo ZKPASSPORT_VERIFIER_ADDR or ZKPASSPORT_DOMAIN set — deploying MockZkPassportVerifierAdapter…');
    const MockFactory = await ethers.getContractFactory('MockZkPassportVerifierAdapter');
    const mock = await MockFactory.deploy();
    await mock.waitForDeployment();
    verifierAddress = await mock.getAddress();
    console.log(`MockZkPassportVerifierAdapter : ${verifierAddress}`);
  } else {
    console.log(`\nUsing verifier adapter at     : ${verifierAddress}`);
  }

  let forwarderAddress = process.env.FORWARDER_ADDR;
  if (!forwarderAddress) {
    console.log('\nDeploying PopulisForwarder (ERC-2771 trusted forwarder)…');
    const ForwarderFactory = await ethers.getContractFactory('PopulisForwarder');
    const forwarder = await ForwarderFactory.deploy();
    await forwarder.waitForDeployment();
    forwarderAddress = await forwarder.getAddress();
    console.log(`PopulisForwarder : ${forwarderAddress}`);
  } else {
    console.log(`\nUsing forwarder at            : ${forwarderAddress}`);
  }

  console.log('\nDeploying PopulisZkPassportAttestationEmitter…');
  const EmitterFactory = await ethers.getContractFactory('PopulisZkPassportAttestationEmitter');
  const emitter = await EmitterFactory.deploy(verifierAddress, bridgePolicyHash, forwarderAddress);
  await emitter.waitForDeployment();
  const emitterAddress = await emitter.getAddress();

  const deployTx = emitter.deploymentTransaction();
  const receipt = await deployTx.wait();

  console.log(`\n✓ PopulisZkPassportAttestationEmitter deployed`);
  console.log(`  Address        : ${emitterAddress}`);
  console.log(`  Tx hash        : ${receipt.hash}`);
  console.log(`  Block          : ${receipt.blockNumber}`);
  console.log(`  Bridge policy  : ${bridgePolicyHash} (constructor arg)`);
  console.log(`  Verifier       : ${verifierAddress} (constructor arg)`);
  console.log(`  Forwarder      : ${forwarderAddress} (constructor arg, ERC-2771)`);

  console.log('\n── Add to portal environment.ts ──────────────────────────────────────────');
  console.log(`zkPassport: {`);
  console.log(`  verificationUrl: '<zkpassport proof URL>',`);
  console.log(`  evmRpcUrl: '${network.config.url || 'http://127.0.0.1:8545'}',`);
  console.log(`  attestationEmitterAddress: '${emitterAddress}',`);
  console.log(`  attestationEmitterFromBlock: ${receipt.blockNumber},`);
  console.log(`  trustedForwarderAddress: '${forwarderAddress}',`);
  console.log(`  bridgeParentId: '0x<chia-coin-parent-id>',`);
  console.log(`  bridgeAmount: 1,`);
  console.log(
    `  validatorPubkeys: ['0xa8f9b0c1f992c49210fc726fc610885b966f84747126753659c6c3f8ae5bf3baf5b6e1a399fc8a749daf45dd74efac4c'],`,
  );
  console.log(`  validatorThreshold: 1,`);
  console.log(`}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
