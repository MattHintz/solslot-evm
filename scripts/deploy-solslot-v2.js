/** Deploy a fresh Solslot v2 forwarder, verifier adapter, and emitter. */
'use strict';

const { ethers, network } = require('hardhat');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for a Solslot v2 deployment`);
  return value;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const bridgePolicyHash = required('SOLSLOT_ZKPASSPORT_BRIDGE_POLICY_HASH');
  const domain = required('SOLSLOT_ZKPASSPORT_DOMAIN');
  const devMode = process.env.SOLSLOT_ZKPASSPORT_DEV_MODE === 'true';

  if (!ethers.isHexString(bridgePolicyHash, 32) || bridgePolicyHash === ethers.ZeroHash) {
    throw new Error('SOLSLOT_ZKPASSPORT_BRIDGE_POLICY_HASH must be a non-zero bytes32');
  }
  if (network.name !== 'hardhat' && !process.env.SOLSLOT_DEPLOYER_PRIVATE_KEY) {
    throw new Error(
      'SOLSLOT_DEPLOYER_PRIVATE_KEY is required outside the local Hardhat network',
    );
  }
  if (network.name === 'baseMainnet' || network.name === 'ethMainnet') {
    throw new Error('Solslot V2 mainnet deployment is disabled during Alpha remediation');
  }

  const Forwarder = await ethers.getContractFactory('SolslotForwarder');
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();

  const Adapter = await ethers.getContractFactory('SolslotZkPassportVerifierAdapter');
  const adapter = await Adapter.deploy(domain, devMode);
  await adapter.waitForDeployment();
  const rootVerifierAddress = await adapter.ZKPASSPORT_ROOT_VERIFIER();
  if (network.name !== 'hardhat' && (await ethers.provider.getCode(rootVerifierAddress)) === '0x') {
    throw new Error(`zkPassport root verifier is not deployed at ${rootVerifierAddress}`);
  }

  const Emitter = await ethers.getContractFactory('SolslotZkPassportAttestationEmitter');
  const emitter = await Emitter.deploy(
    await adapter.getAddress(),
    bridgePolicyHash,
    await forwarder.getAddress(),
  );
  await emitter.waitForDeployment();
  const receipt = await emitter.deploymentTransaction().wait();

  const deployment = {
    schemaVersion: 2,
    protocolVersion: 'solslot-v2',
    credentialPolicyVersion: Number(await emitter.POLICY_VERSION()),
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    forwarderAddress: await forwarder.getAddress(),
    verifierAdapterAddress: await adapter.getAddress(),
    attestationEmitterAddress: await emitter.getAddress(),
    bridgePolicyHash,
    zkPassportRootVerifierAddress: rootVerifierAddress,
    zkPassportDomain: domain,
    zkPassportDevMode: devMode,
    deploymentTxHash: receipt.hash,
    deploymentBlock: receipt.blockNumber,
  };
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
