/** Exact-plan identity deployment. Public planning never accesses a key.
 * A journal contains broadcastable authorizations, so keep it owner-only.
 * No timeout, missing receipt or fee change authorizes a replacement transaction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

export const ROOT_VERIFIER = '0x1d000001000efd9a6371f4d90bb8920d5431c0d8';
export const CONTRACTS = {
  forwarder: 'SolslotForwarder',
  verifierAdapter: 'SolslotZkPassportVerifierAdapter',
  attestationEmitter: 'SolslotZkPassportPermitEmitterV1',
};
export const ELIGIBILITY_CONTRACTS = Object.freeze({
  forwarder: 'SolslotForwarder',
  verifierAdapter: 'SolslotZkPassportEligibilityVerifierV1',
  attestationEmitter: 'SolslotZkPassportAttestationEmitter',
});
export const ELIGIBILITY_POLICY = Object.freeze({schema:'solslot.identity-policy.v1',
  adapter:'SolslotZkPassportEligibilityVerifierV1',domain:'solslot.com',devMode:false,minimumAge:18,
  sanctions:Object.freeze({countries:'all',lists:'all',strict:false})});
const ELIGIBILITY_SCHEMA = 'solslot.sepolia-eligibility-deployment-plan.v1';
export const ELIGIBILITY_BRIDGE_MODULE_HASH = '0x341151935b773901c3f31db323372c88953d96f44a06345cfab9bba2f06ac5fa';
const SOURCES = ['protocol','evm','omnichain','api','legacyBackend','keyOfSolomon','samuel','customerWeb','adminPortal'];
const ADDRESS_FIELDS = ['forwarderAddress','verifierAdapterAddress','attestationEmitterAddress'];
const PLAN_FIELDS = ['schema','environment','network','chainId','sourceShas','releaseIdentity','deploymentId',
  'deployer','startNonce',...ADDRESS_FIELDS,'trustedDirectRelayerAddress','bridgePolicyHash','zkPassportDomain',
  'zkPassportDevMode','zkPassportRootVerifierAddress','rootVerifierCodeHash','permitIssuer','permitContextHash',
  'transactions','validatorPubkeys','bridgeModuleHash','actionEnvelopeId','planHash'];
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
}
export const hashObject = value => ethers.sha256(ethers.toUtf8Bytes(stableJson(value)));
function requireThat(value, message) { if (!value) throw new Error(message); }
function keys(value, fields, label) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','), `${label} fields are incomplete or unsupported`);
}
function hex(value, size, label) {
  requireThat(typeof value === 'string' && new RegExp(`^0x[0-9a-f]{${size*2}}$`).test(value) && value !== '0x'+'00'.repeat(size), `${label} must be canonical nonzero hex`);
}
function integer(value, label) { requireThat(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative safe integer`); }
function decimal(value, label) { requireThat(typeof value === 'string' && /^[1-9][0-9]{0,29}$/.test(value), `${label} must be a positive decimal string`); }
function atom(value) { return ethers.sha256(ethers.concat(['0x01', value])); }
function pair(a,b) { return ethers.sha256(ethers.concat(['0x02',a,b])); }
function listHashes(hashes) { return hashes.reduceRight((acc,item) => pair(item,acc),atom('0x')); }
function list(atoms) { return listHashes(atoms.map(atom)); }
export const BRIDGE_MODULE_HASH = '0x2c8b1ddeb939570bbd9cd2e79ffe3787eb42ab28a3d661fae95354ec8a5eee38';
export function selectedPolicy(validators, context) {
  requireThat(Array.isArray(validators) && validators.length === 3 && new Set(validators).size === 3,'three distinct validators are required');
  validators.forEach(v=>hex(v,48,'validator public key'));hex(context,32,'context');
  const args=[list(validators),'0x02',context];
  const hashes=[args[0],atom(args[1]),atom(args[2])];
  let curried=atom('0x01');
  for (const hash of hashes.reverse()) curried=listHashes([atom('0x04'),pair(atom('0x01'),hash),curried]);
  return listHashes([atom('0x02'),pair(atom('0x01'),BRIDGE_MODULE_HASH),curried]);
}
export function eligibilityBridgePolicy(validators) {
  requireThat(Array.isArray(validators) && validators.length === 3 && new Set(validators).size === 3,'three distinct validators are required');
  validators.forEach(v=>hex(v,48,'validator public key'));
  let curried=atom('0x01');
  for (const hash of [list(validators),atom('0x02')].reverse()) curried=listHashes([atom('0x04'),pair(atom('0x01'),hash),curried]);
  return listHashes([atom('0x02'),pair(atom('0x01'),ELIGIBILITY_BRIDGE_MODULE_HASH),curried]);
}
function eligibility(plan) { return plan.schema === ELIGIBILITY_SCHEMA; }
function deploymentSpec(plan) {
  return eligibility(plan) ? {contracts:ELIGIBILITY_CONTRACTS,args:[[],[],[plan.verifierAdapterAddress,
    plan.bridgePolicyHash,plan.forwarderAddress,plan.trustedDirectRelayerAddress]]}
    : {contracts:CONTRACTS,args:[[],[plan.zkPassportDomain,false],[plan.verifierAdapterAddress,plan.bridgePolicyHash,
      plan.forwarderAddress,plan.trustedDirectRelayerAddress,plan.permitIssuer,plan.permitContextHash]]};
}

const IDENTITY_NETWORKS = Object.freeze({
  baseSepolia: { chainId: 84532, clvmAtom: '0x014a34' },
  base: { chainId: 8453, clvmAtom: '0x2105' },
});
function identityNetwork(plan) {
  const selected = Object.hasOwn(IDENTITY_NETWORKS, plan.network) ? IDENTITY_NETWORKS[plan.network] : undefined;
  requireThat(selected && selected.chainId === plan.chainId, 'identity network must be explicit Base/8453 or Base Sepolia/84532');
  return selected;
}
export function selectedContext(plan) {
  const selected = identityNetwork(plan);
  return list([ethers.toUtf8Bytes('solslot-enrollment-context-v1'),ethers.toUtf8Bytes(plan.environment),
    ethers.toUtf8Bytes('testnet11'),selected.clvmAtom,plan.attestationEmitterAddress,plan.permitIssuer,plan.deploymentId,plan.releaseIdentity]);
}
export function validatePlan(plan) {
  const isEligibility=eligibility(plan);
  const fields=isEligibility ? [...PLAN_FIELDS.filter(k=>!['permitIssuer','permitContextHash'].includes(k)), 'identityPolicy'] : PLAN_FIELDS;
  keys(plan, fields, 'deployment plan');
  const { planHash, ...unsigned } = plan;
  requireThat(planHash === hashObject(unsigned), 'deployment plan hash differs');
  requireThat(isEligibility || plan.schema === 'solslot.selected-deployment-plan.v1', 'deployment plan schema differs');
  if (isEligibility) {
    requireThat(plan.network === 'ethSepolia' && plan.chainId === 11155111 && plan.environment === 'production-alpha', 'eligibility requires solslot.com on Ethereum Sepolia');
    requireThat(stableJson(plan.identityPolicy) === stableJson(ELIGIBILITY_POLICY),'identity policy differs');
  } else identityNetwork(plan);
  requireThat(['staging-alpha','production-alpha'].includes(plan.environment) && plan.zkPassportDomain === (plan.environment === 'staging-alpha' ? 'staging.solslot.com' : 'solslot.com') && plan.zkPassportDevMode === false, 'deployment host or devMode differs');
  keys(plan.sourceShas, SOURCES, 'source revisions');
  requireThat(Object.values(plan.sourceShas).every(v => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v) && v !== '0'.repeat(40)), 'nine nonzero Git revisions are required');
  requireThat(plan.releaseIdentity === hashObject({schema:'solslot.enrollment-release.v1',sourceShas:plan.sourceShas}), 'release identity differs');
  for (const field of ['deployer',...ADDRESS_FIELDS,'trustedDirectRelayerAddress',...(!isEligibility?['permitIssuer']:[])]) hex(plan[field],20,field);
  for (const field of ['deploymentId','bridgePolicyHash','rootVerifierCodeHash',...(!isEligibility?['permitContextHash']:[])]) hex(plan[field],32,field);
  integer(plan.startNonce,'startNonce'); requireThat(plan.startNonce <= Number.MAX_SAFE_INTEGER-3,'startNonce overflows');
  requireThat(plan.zkPassportRootVerifierAddress === ROOT_VERIFIER, 'root verifier differs');
  if (isEligibility) {
    requireThat(plan.bridgeModuleHash === ELIGIBILITY_BRIDGE_MODULE_HASH && plan.bridgePolicyHash === eligibilityBridgePolicy(plan.validatorPubkeys),'eligibility bridge policy does not reconstruct');
  } else {
    requireThat(plan.permitContextHash === selectedContext(plan),'permit context does not reconstruct');
    requireThat(plan.bridgeModuleHash === BRIDGE_MODULE_HASH && plan.bridgePolicyHash === selectedPolicy(plan.validatorPubkeys,plan.permitContextHash),'bridge policy does not reconstruct');
  }
  requireThat(typeof plan.actionEnvelopeId === 'string' && /^AE-SOLSLOT-[A-Z0-9-]{1,128}$/.test(plan.actionEnvelopeId), 'exact ActionEnvelope identifier is required');
  keys(plan.transactions,Object.keys(CONTRACTS),'transactions');
  Object.keys(CONTRACTS).forEach((name,i) => {
    requireThat(plan[ADDRESS_FIELDS[i]] === ethers.getCreateAddress({from:plan.deployer,nonce:plan.startNonce+i}).toLowerCase(),'planned CREATE address differs');
    const tx=plan.transactions[name]; keys(tx,['nonce','initCodeHash','gasLimit','maxFeePerGas','maxPriorityFeePerGas'],name);
    requireThat(tx.nonce === plan.startNonce+i,'ordered deployment nonce differs'); hex(tx.initCodeHash,32,'initCodeHash');
    for (const field of ['gasLimit','maxFeePerGas','maxPriorityFeePerGas']) decimal(tx[field],field);
    requireThat(BigInt(tx.maxPriorityFeePerGas) <= BigInt(tx.maxFeePerGas),'priority fee exceeds maximum fee');
  });
  return plan;
}
export async function deploymentRequests(plan, getFactory) {
  const {contracts,args}=deploymentSpec(plan);
  const requests=[];
  for (const [i,[name,contract]] of Object.entries(contracts).entries()) {
    const factory=await getFactory(contract); const deploy=await factory.getDeployTransaction(...args[i]);
    const fixed=plan.transactions[name];
    requireThat(ethers.keccak256(deploy.data) === fixed.initCodeHash, `${name} compiled init code differs from reviewed plan`);
    requests.push({type:2,chainId:BigInt(plan.chainId),nonce:fixed.nonce,to:null,value:0n,data:deploy.data,
      gasLimit:BigInt(fixed.gasLimit),maxFeePerGas:BigInt(fixed.maxFeePerGas),maxPriorityFeePerGas:BigInt(fixed.maxPriorityFeePerGas),accessList:[]});
  }
  return requests;
}
// Canonical bytes reject duplicate JSON fields and alternative number encodings.
export function readCanonical(file, pin) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const s=fs.fstatSync(fd); requireThat(s.isFile() && s.size>0 && s.size<=2*1024*1024,'deployment evidence must be a bounded regular file');
    const raw=fs.readFileSync(fd); const value=JSON.parse(raw.toString('utf8'));
    requireThat(raw.toString('utf8') === stableJson(value)+'\n','deployment evidence must be canonical JSON');
    if (pin !== undefined) { hex('0x'+pin,32,'file checksum');requireThat(ethers.sha256(raw) === '0x'+pin,'deployment file differs from independently supplied checksum'); }
    return value;
  } finally { fs.closeSync(fd); }
}
function protectedDirectory(directory) {
  const absolute=path.resolve(directory);
  let current=path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current=path.join(current,part); if (!fs.existsSync(current)) fs.mkdirSync(current,{mode:0o700});
    const stat=fs.lstatSync(current);requireThat(stat.isDirectory() && !stat.isSymbolicLink(),'deployment paths must not contain symlinks');
  }
  const stat=fs.statSync(absolute);requireThat(stat.uid === process.getuid() && (stat.mode&0o077) === 0,'deployment journal directory must be owner-only');
}
function writeOnce(file, value) {
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try { fs.writeFileSync(fd,stableJson(value)+'\n');fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY);try {fs.fsyncSync(dir);} finally {fs.closeSync(dir);}
}
function readJournal(file) {
  const stat=fs.lstatSync(file); requireThat(!stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode&0o077) === 0,'deployment journal must be owner-only');
  return readCanonical(file);
}
function validateSigned(raw, request, deployer) {
  const tx=ethers.Transaction.from(raw);
  requireThat(tx.isSigned() && tx.serialized === raw && tx.from.toLowerCase() === deployer,'saved deployment signature differs');
  for (const field of ['type','chainId','nonce','to','value','data','gasLimit','maxFeePerGas','maxPriorityFeePerGas'])
    requireThat(tx[field] === request[field],`saved deployment ${field} differs`);
  requireThat(stableJson(tx.accessList) === '[]','saved deployment access list differs');
  return tx.hash;
}
async function boundary(provider, plan) {
  requireThat((await provider.getNetwork()).chainId === BigInt(plan.chainId),`RPC is not selected identity network ${plan.network}/${plan.chainId}`);
  const code=await provider.getCode(ROOT_VERIFIER);
  requireThat(code !== '0x' && ethers.keccak256(code) === plan.rootVerifierCodeHash,'root verifier code differs or is unavailable');
}
async function observe(provider, plan, requests, hashes) {
  const peak=await provider.getBlock('latest');requireThat(peak && peak.hash,'canonical peak unavailable');
  const receipts=[];
  for (const [i,hash] of hashes.entries()) {
    const receipt=await provider.getTransactionReceipt(hash);
    if (!receipt) { receipts.push(null);continue; }
    const tx=await provider.getTransaction(hash);const block=await provider.getBlock(receipt.blockNumber);
    requireThat(receipt.hash === hash && receipt.status === 1 && tx && tx.hash === hash &&
      receipt.blockHash === block?.hash && tx.blockHash === receipt.blockHash && tx.blockNumber === receipt.blockNumber &&
      receipt.contractAddress?.toLowerCase() === plan[ADDRESS_FIELDS[i]],'deployment receipt failed or is noncanonical');
    requireThat(tx.from.toLowerCase() === plan.deployer && tx.nonce === requests[i].nonce && tx.to === null &&
      tx.chainId === BigInt(plan.chainId) && tx.value === 0n && tx.data === requests[i].data,'mined deployment transaction differs');
    requireThat(receipt.blockNumber <= peak.number,'deployment receipt is beyond observed peak');
    receipts.push({...receipt,confirmations:peak.number-receipt.blockNumber+1});
  }
  requireThat((await provider.getBlock(peak.number))?.hash === peak.hash,'chain reorganized during deployment observation');
  return {peak,receipts};
}
export async function runSelectedDeployment({plan,provider,getFactory,signerFactory,journalDirectory,execute=false,resubmit=false}) {
  validatePlan(plan); const requests=await deploymentRequests(plan,getFactory);
  await boundary(provider,plan);
  if (!execute) return {status:'planned',planHash:plan.planHash,actionEnvelopeId:plan.actionEnvelopeId,addresses:ADDRESS_FIELDS.map(k=>plan[k])};
  protectedDirectory(journalDirectory);
  const journalPath=path.join(journalDirectory,'signed-deployments.json');
  let journal;
  if (fs.existsSync(journalPath)) {
    journal=readJournal(journalPath);
  } else {
    // Fail closed after a process dies here: an incomplete file/lock requires
    // operator reconciliation, never deletion or automatic nonce replacement.
    const lock=path.join(journalDirectory,'signing.lock'); const fd=fs.openSync(lock,'wx',0o600);fs.fsyncSync(fd);fs.closeSync(fd);
    try {
      requireThat(await provider.getTransactionCount(plan.deployer,'latest') === plan.startNonce &&
        await provider.getTransactionCount(plan.deployer,'pending') === plan.startNonce,'deployer nonce differs from the approved plan');
      for (const field of ADDRESS_FIELDS) requireThat(await provider.getCode(plan[field]) === '0x','planned deployment address is occupied');
      const maximum=requests.reduce((n,tx)=>n+tx.gasLimit*tx.maxFeePerGas,0n);
      requireThat(await provider.getBalance(plan.deployer) >= maximum,'deployer cannot cover the fixed maximum fees');
      const signer=await signerFactory();requireThat((await signer.getAddress()).toLowerCase() === plan.deployer,'keystore does not match planned deployer');
      const signed=[];for (const request of requests) signed.push(await signer.signTransaction(request));
      signed.forEach((raw,i)=>validateSigned(raw,requests[i],plan.deployer));
      journal={schema:'solslot.signed-deployments.v1',planHash:plan.planHash,actionEnvelopeId:plan.actionEnvelopeId,signed};
      writeOnce(journalPath,journal);
    } finally { fs.unlinkSync(lock); }
  }
  keys(journal,['schema','planHash','actionEnvelopeId','signed'],'deployment journal');
  requireThat(journal.schema === 'solslot.signed-deployments.v1' && journal.planHash === plan.planHash && journal.actionEnvelopeId === plan.actionEnvelopeId && Array.isArray(journal.signed) && journal.signed.length === 3,'saved deployment belongs to another plan');
  const hashes=journal.signed.map((raw,i)=>validateSigned(raw,requests[i],plan.deployer));
  const state=await observe(provider,plan,requests,hashes);
  for (let i=0;i<3;i++) {
    const receipt=state.receipts[i];
    if (receipt?.confirmations >= 12) continue;
    if (receipt) return {status:'confirming',transactionHash:hashes[i],confirmations:receipt.confirmations,required:12};
    await boundary(provider,plan);
    const known=await provider.getTransaction(hashes[i]);
    requireThat(await provider.getCode(plan[ADDRESS_FIELDS[i]]) === '0x','unrecognized code at planned address');
    requireThat(await provider.getTransactionCount(plan.deployer,'latest') <= requests[i].nonce,'nonce consumed without canonical original receipt');
    if (!known) requireThat(await provider.getTransactionCount(plan.deployer,'pending') <= requests[i].nonce,'nonce occupied by an unrecognized transaction');
    if (!known || resubmit) {
      // Mark an attempt durably before RPC. Concurrent callers may only send
      // identical bytes; the immutable journal forbids fresh signing/fees.
      const attempt=path.join(journalDirectory,`submission-${i}.json`);
      if (!fs.existsSync(attempt)) { try {writeOnce(attempt,{planHash:plan.planHash,transactionHash:hashes[i]});} catch(error) {if(error.code!=='EEXIST')throw error;} }
      const marker=readJournal(attempt);requireThat(marker.planHash === plan.planHash && marker.transactionHash === hashes[i],'submission marker differs');
      try {const sent=await provider.broadcastTransaction(journal.signed[i]);requireThat(sent.hash === hashes[i],'RPC returned another transaction');}
      catch {return {status:'submission_unknown',transactionHash:hashes[i],recovery:'Observe or resend the original signed transaction; do not change plan, nonce or fees.'};}
    }
    return {status:'submitted',transactionHash:hashes[i],required:12};
  }
  const runtimeCodeHashes={};
  for (const [i,name] of Object.keys(CONTRACTS).entries()) {
    const code=await provider.getCode(plan[ADDRESS_FIELDS[i]],state.peak.number);requireThat(code!=='0x','confirmed deployment has no runtime code');runtimeCodeHashes[name]=ethers.keccak256(code);
  }
  const root=await provider.getCode(ROOT_VERIFIER,state.peak.number);
  requireThat(ethers.keccak256(root) === plan.rootVerifierCodeHash,'root verifier changed at evidence snapshot');runtimeCodeHashes.zkPassportRootVerifier=plan.rootVerifierCodeHash;
  requireThat((await provider.getBlock(state.peak.number))?.hash === state.peak.hash,'chain reorganized during runtime observation');
  const deployment={schemaVersion:eligibility(plan)?2:3,protocolVersion:'solslot-v2',credentialPolicyVersion:2,network:plan.network,chainId:plan.chainId,
    sourceShas:plan.sourceShas,deployer:plan.deployer,startNonce:plan.startNonce,
    ...Object.fromEntries(ADDRESS_FIELDS.map(k=>[k,plan[k]])),trustedDirectRelayerAddress:plan.trustedDirectRelayerAddress,
    bridgePolicyHash:plan.bridgePolicyHash,zkPassportRootVerifierAddress:ROOT_VERIFIER,zkPassportDomain:plan.zkPassportDomain,zkPassportDevMode:false,
    ...(eligibility(plan)?{identityPolicy:plan.identityPolicy}:{permitIssuer:plan.permitIssuer,permitContextHash:plan.permitContextHash}),
    deploymentId:plan.deploymentId,releaseIdentity:plan.releaseIdentity,
    deploymentTransactions:Object.fromEntries(Object.keys(CONTRACTS).map((name,i)=>[name,{hash:hashes[i],blockNumber:state.receipts[i].blockNumber,
      blockHash:state.receipts[i].blockHash,nonce:requests[i].nonce,initCodeHash:ethers.keccak256(requests[i].data)}])),runtimeCodeHashes};
  const artifact={...deployment,artifactHash:hashObject(deployment)}; const output=path.join(journalDirectory,'deployment.json');
  if (fs.existsSync(output)) requireThat(stableJson(readJournal(output)) === stableJson(artifact),'existing deployment evidence differs');
  else writeOnce(output,artifact);
  return {status:'deployed_awaiting_independent_review',artifactHash:artifact.artifactHash,output,transactionHashes:hashes};
}

/** Offline construction only: the output must receive its own source/build and
 * ActionEnvelope review before an operator independently pins and executes it. */
export async function prepareSelectedPlan(input, getFactory) {
  const hasNetwork = Object.hasOwn(input, 'network');
  const hasChain = Object.hasOwn(input, 'chainId');
  requireThat(hasNetwork === hasChain, 'identity network and chainId must be selected together');
  const selected = hasNetwork ? { network: input.network, chainId: input.chainId } : { network: 'baseSepolia', chainId: 84532 };
  identityNetwork(selected);
  keys(input,[...(hasNetwork ? ['network','chainId'] : []),'environment','sourceShas','deploymentId','deployer','startNonce','trustedDirectRelayerAddress',
    'permitIssuer','validatorPubkeys','rootVerifierCodeHash','fees','actionEnvelopeId'],'planning input');
  keys(input.fees,Object.keys(CONTRACTS),'deployment fees');
  const {fees,...core}=input;
  const plan={...core,schema:'solslot.selected-deployment-plan.v1',...selected,
    releaseIdentity:hashObject({schema:'solslot.enrollment-release.v1',sourceShas:input.sourceShas}),
    zkPassportDomain:input.environment === 'staging-alpha' ? 'staging.solslot.com' : 'solslot.com',
    zkPassportDevMode:false,zkPassportRootVerifierAddress:ROOT_VERIFIER,bridgeModuleHash:BRIDGE_MODULE_HASH};
  ADDRESS_FIELDS.forEach((field,i)=>{plan[field]=ethers.getCreateAddress({from:input.deployer,nonce:input.startNonce+i}).toLowerCase();});
  plan.permitContextHash=selectedContext(plan);plan.bridgePolicyHash=selectedPolicy(input.validatorPubkeys,plan.permitContextHash);
  const args=[[],[plan.zkPassportDomain,false],[plan.verifierAdapterAddress,plan.bridgePolicyHash,plan.forwarderAddress,
    plan.trustedDirectRelayerAddress,plan.permitIssuer,plan.permitContextHash]];
  plan.transactions={};
  for (const [i,[name,contract]] of Object.entries(CONTRACTS).entries()) {
    keys(fees[name],['gasLimit','maxFeePerGas','maxPriorityFeePerGas'],'fixed deployment fee');
    const tx=await (await getFactory(contract)).getDeployTransaction(...args[i]);
    plan.transactions[name]={...fees[name],nonce:input.startNonce+i,initCodeHash:ethers.keccak256(tx.data)};
  }
  plan.planHash=hashObject(plan);return validatePlan(plan);
}

/** Explicit Sepolia age + sanctions deployment; no permit-activation migration.
 * Its legacy bridge puzzle is reconstructed from the three reviewed BLS keys.
 */
export async function prepareEligibilityPlan(input, getFactory) {
  keys(input,['environment','network','chainId','sourceShas','deploymentId','deployer','startNonce',
    'trustedDirectRelayerAddress','validatorPubkeys','rootVerifierCodeHash','fees','actionEnvelopeId'],'eligibility planning input');
  keys(input.fees,Object.keys(ELIGIBILITY_CONTRACTS),'deployment fees');
  requireThat(input.environment === 'production-alpha' && input.network === 'ethSepolia' && input.chainId === 11155111,
    'eligibility requires solslot.com on Ethereum Sepolia');
  const {fees,...core}=input;
  const plan={...core,schema:ELIGIBILITY_SCHEMA,identityPolicy:ELIGIBILITY_POLICY,
    releaseIdentity:hashObject({schema:'solslot.enrollment-release.v1',sourceShas:input.sourceShas}),
    zkPassportDomain:'solslot.com',zkPassportDevMode:false,zkPassportRootVerifierAddress:ROOT_VERIFIER,
    bridgeModuleHash:ELIGIBILITY_BRIDGE_MODULE_HASH,bridgePolicyHash:eligibilityBridgePolicy(input.validatorPubkeys)};
  ADDRESS_FIELDS.forEach((field,i)=>{plan[field]=ethers.getCreateAddress({from:input.deployer,nonce:input.startNonce+i}).toLowerCase();});
  const {contracts,args}=deploymentSpec(plan);
  plan.transactions={};
  for (const [i,[name,contract]] of Object.entries(contracts).entries()) {
    keys(fees[name],['gasLimit','maxFeePerGas','maxPriorityFeePerGas'],'fixed deployment fee');
    const tx=await (await getFactory(contract)).getDeployTransaction(...args[i]);
    plan.transactions[name]={...fees[name],nonce:input.startNonce+i,initCodeHash:ethers.keccak256(tx.data)};
  }
  plan.planHash=hashObject(plan);return validatePlan(plan);
}
