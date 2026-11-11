/** R1 only: executes constructors on an explicitly simulated local chain.
 * Reads public context and writes init/runtime commitments. No live signer.
 */
import fs from 'node:fs';
import { network } from 'hardhat';

const [inputPath, outputPath, ...extra] = process.argv.slice(2);
if (!inputPath || !outputPath || extra.length) throw Error('PUBLIC_INPUT_AND_NEW_OUTPUT_REQUIRED');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const { ethers } = await network.create('selectedBaseLocal');
if (Number((await ethers.provider.getNetwork()).chainId) !== 8453) throw Error('SIMULATED_BASE_REQUIRED');
// This named network is edr-simulated in the reviewed local configuration.
// No network supplied by command arguments or input is accepted.
const adapterFactory = await ethers.getContractFactory('SolslotZkPassportEligibilityVerifierV4');
const emitterFactory = await ethers.getContractFactory('SolslotZkPassportAttestationEmitter');
const adapter = await adapterFactory.deploy();
const emitterArgs = [input.adapterAddress, input.bridgePolicyHash, input.forwarder, input.sender];
const emitter = await emitterFactory.deploy(...emitterArgs);
await adapter.waitForDeployment(); await emitter.waitForDeployment();
const records = [];
for (const [role, name, factory, instance, args, address, nonce] of [
  ['verifierAdapter', 'SolslotZkPassportEligibilityVerifierV4', adapterFactory, adapter, [], input.adapterAddress, input.pendingNonce],
  ['attestationEmitter', 'SolslotZkPassportAttestationEmitter', emitterFactory, emitter, emitterArgs, input.emitterAddress, input.pendingNonce + 1],
]) {
  if (ethers.getCreateAddress({from:input.sender, nonce}).toLowerCase() !== address.toLowerCase())
    throw Error('PREDICTED_PUBLIC_ADDRESS_CHANGED');
  const tx = await factory.getDeployTransaction(...args);
  const runtime = await ethers.provider.getCode(await instance.getAddress());
  records.push({role, contract:name, address:address.toLowerCase(), nonce,
    data:tx.data, initCodeHash:ethers.keccak256(tx.data), runtimeCodeHash:ethers.keccak256(runtime)});
}
const versions = ['000000140000','000000150000','000000150001','000000160000'].map(v=>'0x'+v+'00'.repeat(26));
for (const version of versions) if (!await adapter.supportsProofVersion(version)) throw Error('REVIEWED_VERSION_NOT_ADMITTED');
if (await adapter.supportsProofVersion('0x000000150002'+'00'.repeat(26))) throw Error('FUTURE_VERSION_ADMITTED');
if (await adapter.devMode() || await adapter.domain() !== 'solslot.com') throw Error('REAL_DOCUMENT_POLICY_CHANGED');
const result = {schema:'solslot.identity-compatibility-constructor-evidence.r1.v1',
  publicContext:input, records, acceptedProofVersions:['0.20.0','0.21.0','0.21.1','0.22.0'],
  realDocumentOnly:true, localSimulation:true, liveTransactions:0, signingKeyRead:false};
const fd = fs.openSync(outputPath, 'wx', 0o600);
try { fs.writeFileSync(fd, JSON.stringify(result, null, 2)+'\n');fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
console.log(JSON.stringify({state:'EXACT_CONSTRUCTORS_SIMULATED_NO_LIVE_TRANSACTION',
  contracts:records.map(({data,...record})=>record),output:outputPath}));
