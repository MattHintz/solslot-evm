/** Deploy a fresh Solslot v2 forwarder, verifier adapter, and emitter. */

import fs from 'node:fs';
import path from 'node:path';
import { network } from 'hardhat';
import { readCanonical, validatePlan, runSelectedDeployment } from './selected-deployment.js';

const connection = await network.create();
const { ethers, networkName } = connection;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for a Solslot v2 deployment`);
  return value;
}

function requiredSha(name) {
  const value = required(name).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${name} must be a full 40-character Git commit SHA`);
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function runtimeCodeHash(address) {
  const code = await ethers.provider.getCode(address);
  if (code === '0x') throw new Error(`No runtime bytecode at ${address}`);
  return ethers.keccak256(code);
}

async function deploymentSigner() {
  if (networkName === 'hardhat') {
    const [signer] = await ethers.getSigners();
    return signer;
  }

  const keystorePath = path.resolve(required('SOLSLOT_DEPLOYER_KEYSTORE_PATH'));
  const descriptor = Number(required('SOLSLOT_KEYSTORE_PASSPHRASE_FD'));
  if (!Number.isInteger(descriptor) || descriptor < 3) {
    throw new Error('SOLSLOT_KEYSTORE_PASSPHRASE_FD must name a dedicated file descriptor');
  }
  const stat = fs.lstatSync(keystorePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('EVM operator keystore must be a regular owner-only file');
  }

  const passphraseBytes = fs.readFileSync(descriptor);
  let wallet;
  try {
    const passphrase = passphraseBytes.toString('utf8').replace(/[\r\n]+$/, '');
    wallet = await ethers.Wallet.fromEncryptedJson(
      fs.readFileSync(keystorePath, 'utf8'),
      passphrase,
    );
  } finally {
    passphraseBytes.fill(0);
  }
  const expectedAddress = String(process.env.SOLSLOT_EVM_OPERATOR_ADDRESS || '').trim();
  if (
    expectedAddress &&
    (!ethers.isAddress(expectedAddress) ||
      wallet.address.toLowerCase() !== expectedAddress.toLowerCase())
  ) {
    throw new Error('Encrypted keystore address does not match SOLSLOT_EVM_OPERATOR_ADDRESS');
  }
  return wallet.connect(ethers.provider);
}

async function main() {
  // Presence (including empty/malformed values) selects the strict path.
  // Validation and RPC identity precede any signer/key access.
  if (Object.hasOwn(process.env, 'SOLSLOT_EVM_DEPLOYMENT_PLAN')) {
    const plan = validatePlan(readCanonical(required('SOLSLOT_EVM_DEPLOYMENT_PLAN'), required('SOLSLOT_EVM_PLAN_SHA256')));
    if (networkName !== plan.network) throw new Error('Hardhat network differs from selected identity plan');
    const execute = process.env.SOLSLOT_EVM_DEPLOYMENT_EXECUTE === 'approved';
    if (execute && required('SOLSLOT_ACTION_ENVELOPE_ID') !== plan.actionEnvelopeId) throw new Error('ActionEnvelope differs from plan');
    const result = await runSelectedDeployment({plan, provider: ethers.provider,
      getFactory: name => ethers.getContractFactory(name), signerFactory: deploymentSigner,
      journalDirectory: execute ? required('SOLSLOT_EVM_DEPLOYMENT_JOURNAL') : undefined,
      execute, resubmit: process.env.SOLSLOT_EVM_RESUBMIT_ORIGINAL === 'true'});
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 11155111n && !(networkName === 'hardhat' && chainId === 31337n)) {
    throw new Error('Legacy deployment requires Ethereum Sepolia; Base identity deployment requires an exact selected plan');
  }
  const bridgePolicyHash = required('SOLSLOT_ZKPASSPORT_BRIDGE_POLICY_HASH');
  const domain = required('SOLSLOT_ZKPASSPORT_DOMAIN');
  const directRelayerAddress = required('SOLSLOT_ZKPASSPORT_BLS_RELAYER_ADDRESS');
  const evmSourceSha = requiredSha('SOLSLOT_EVM_SOURCE_SHA');
  const protocolSourceSha = requiredSha('SOLSLOT_PROTOCOL_SOURCE_SHA');
  const outputPath = path.resolve(required('SOLSLOT_EVM_DEPLOYMENT_OUTPUT'));
  const devMode = process.env.SOLSLOT_ZKPASSPORT_DEV_MODE === 'true';
  const policyName = process.env.SOLSLOT_IDENTITY_POLICY || 'age-only';
  if (!['age-only', 'age-sanctions-v1'].includes(policyName)) throw new Error('Unknown identity policy');
  const eligibility = policyName === 'age-sanctions-v1';
  if (eligibility && (domain !== 'solslot.com' || devMode)) throw new Error('Eligibility requires solslot.com and real passports');
  if (eligibility && networkName !== 'hardhat') {
    throw new Error('Eligibility deployment requires an exact SOLSLOT_EVM_DEPLOYMENT_PLAN and durable journal');
  }
  const identityPolicy = eligibility ? {schema:'solslot.identity-policy.v1',adapter:'SolslotZkPassportEligibilityVerifierV1',
    domain:'solslot.com',devMode:false,minimumAge:18,sanctions:{countries:'all',lists:'all',strict:false}} : undefined;
  const confirmations = networkName === 'hardhat'
    ? 1
    : Number(process.env.SOLSLOT_EVM_CONFIRMATIONS || 12);

  if (!ethers.isHexString(bridgePolicyHash, 32) || bridgePolicyHash === ethers.ZeroHash) {
    throw new Error('SOLSLOT_ZKPASSPORT_BRIDGE_POLICY_HASH must be a non-zero bytes32');
  }
  if (!ethers.isAddress(directRelayerAddress) || directRelayerAddress === ethers.ZeroAddress) {
    throw new Error('SOLSLOT_ZKPASSPORT_BLS_RELAYER_ADDRESS must be a non-zero address');
  }
  if (
    !Number.isSafeInteger(confirmations) ||
    confirmations < 1 ||
    (networkName !== 'hardhat' && confirmations < 12)
  ) {
    throw new Error('SOLSLOT_EVM_CONFIRMATIONS must be at least 12 outside Hardhat');
  }
  if (fs.existsSync(outputPath)) {
    throw new Error(`Refusing to overwrite existing deployment evidence: ${outputPath}`);
  }
  if (networkName === 'baseMainnet' || networkName === 'ethMainnet') {
    throw new Error('Solslot V2 mainnet deployment is disabled during Alpha remediation');
  }

  const deployer = await deploymentSigner();
  const Forwarder = await ethers.getContractFactory('SolslotForwarder', deployer);
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const forwarderReceipt = await forwarder.deploymentTransaction().wait(confirmations);

  const Adapter = await ethers.getContractFactory(
    eligibility ? 'SolslotZkPassportEligibilityVerifierV1' : 'SolslotZkPassportVerifierAdapter',
    deployer,
  );
  const adapter = eligibility ? await Adapter.deploy() : await Adapter.deploy(domain, devMode);
  await adapter.waitForDeployment();
  const adapterReceipt = await adapter.deploymentTransaction().wait(confirmations);
  const rootVerifierAddress = await adapter.ZKPASSPORT_ROOT_VERIFIER();
  if (networkName !== 'hardhat' && (await ethers.provider.getCode(rootVerifierAddress)) === '0x') {
    throw new Error(`zkPassport root verifier is not deployed at ${rootVerifierAddress}`);
  }

  const Emitter = await ethers.getContractFactory(
    'SolslotZkPassportAttestationEmitter',
    deployer,
  );
  const emitter = await Emitter.deploy(
    await adapter.getAddress(),
    bridgePolicyHash,
    await forwarder.getAddress(),
    directRelayerAddress,
  );
  await emitter.waitForDeployment();
  const emitterReceipt = await emitter.deploymentTransaction().wait(confirmations);

  const forwarderAddress = await forwarder.getAddress();
  const adapterAddress = await adapter.getAddress();
  const emitterAddress = await emitter.getAddress();
  const rootVerifierRuntimeCodeHash =
    networkName === 'hardhat' ? null : await runtimeCodeHash(rootVerifierAddress);

  const deployment = {
    schemaVersion: 2,
    protocolVersion: 'solslot-v2',
    credentialPolicyVersion: Number(await emitter.POLICY_VERSION()),
    ...(identityPolicy ? { identityPolicy } : {}),
    network: networkName,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    confirmations,
    createdAt: new Date().toISOString(),
    sourceShas: {
      evm: evmSourceSha,
      protocol: protocolSourceSha,
    },
    deployer: deployer.address,
    forwarderAddress,
    verifierAdapterAddress: adapterAddress,
    attestationEmitterAddress: emitterAddress,
    trustedDirectRelayerAddress: directRelayerAddress,
    bridgePolicyHash,
    zkPassportRootVerifierAddress: rootVerifierAddress,
    zkPassportDomain: domain,
    zkPassportDevMode: devMode,
    deploymentTransactions: {
      forwarder: {
        hash: forwarderReceipt.hash,
        blockNumber: forwarderReceipt.blockNumber,
      },
      verifierAdapter: {
        hash: adapterReceipt.hash,
        blockNumber: adapterReceipt.blockNumber,
      },
      attestationEmitter: {
        hash: emitterReceipt.hash,
        blockNumber: emitterReceipt.blockNumber,
      },
    },
    runtimeCodeHashes: {
      forwarder: await runtimeCodeHash(forwarderAddress),
      verifierAdapter: await runtimeCodeHash(adapterAddress),
      attestationEmitter: await runtimeCodeHash(emitterAddress),
      zkPassportRootVerifier: rootVerifierRuntimeCodeHash,
    },
  };
  const artifact = {
    ...deployment,
    artifactHash: ethers.sha256(ethers.toUtf8Bytes(stableJson(deployment))),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify(artifact, null, 2));
  console.error(`Wrote non-overwritable Solslot V2 EVM evidence to ${outputPath}`);
}

main().catch((error) => {
  if (Object.hasOwn(process.env, 'SOLSLOT_EVM_DEPLOYMENT_PLAN')) {
    console.error('Selected deployment stopped. Preserve the plan and journal; reconcile public RPC evidence before retrying. No replacement is authorized.');
  } else { console.error(error); }
  process.exitCode = 1;
});
