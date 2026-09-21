import { expect } from 'chai';
import { network } from 'hardhat';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareSelectedPlan, runSelectedDeployment, validatePlan, hashObject, readCanonical,
  stableJson, ROOT_VERIFIER, CONTRACTS, selectedPolicy, selectedContext, deploymentRequests } from '../scripts/selected-deployment.js';
const { ethers, networkHelpers }=await network.create('selectedLocal');
const vector=JSON.parse(fs.readFileSync(new URL('./fixtures/enrollment-permit-v1.json',import.meta.url)));
const baseVector=JSON.parse(fs.readFileSync(new URL('./fixtures/enrollment-permit-base-identity-v1.json',import.meta.url)));
const b32=n=>'0x'+n.repeat(32);
const directories=[];
async function fixture(selection = {}) {
  const wallet=ethers.Wallet.createRandom().connect(ethers.provider);
  await ethers.provider.send('hardhat_setBalance',[wallet.address,'0x1000000000000000000']);
  await ethers.provider.send('hardhat_setCode',[ROOT_VERIFIER,'0x60006000f3']);
  const sourceShas=Object.fromEntries(['protocol','evm','omnichain','api','legacyBackend','keyOfSolomon','samuel','customerWeb','adminPortal'].map((k,i)=>[k,(i+1).toString(16).repeat(40)]));
  const plan=await prepareSelectedPlan({...selection,environment:'staging-alpha',sourceShas,deploymentId:b32('51'),
    deployer:wallet.address.toLowerCase(),startNonce:0,trustedDirectRelayerAddress:ethers.Wallet.createRandom().address.toLowerCase(),
    permitIssuer:ethers.Wallet.createRandom().address.toLowerCase(),validatorPubkeys:vector.validatorPubkeys,
    rootVerifierCodeHash:ethers.keccak256('0x60006000f3'),actionEnvelopeId:'AE-SOLSLOT-SYNTHETIC-LOCAL-ONLY',
    fees:Object.fromEntries(Object.keys(CONTRACTS).map(k=>[k,{gasLimit:'5000000',maxFeePerGas:'5000000000',maxPriorityFeePerGas:'1000000000'}]))},
    name=>ethers.getContractFactory(name));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'solslot-deployment-test-'));directories.push(directory);
  let signs=0;
  const run=(extra={})=>runSelectedDeployment({plan,provider:ethers.provider,getFactory:name=>ethers.getContractFactory(name),
    signerFactory:async()=>{signs++;return wallet;},journalDirectory:directory,execute:true,...extra});
  return {wallet,plan,directory,run,signs:()=>signs};
}
function edit(plan,change) {const p=structuredClone(plan);change(p);delete p.planHash;p.planHash=hashObject(p);return p;}
async function rejected(action,match) {let error;try {await action();}catch(e){error=e;}expect(error?.message).to.match(match);}
after(()=>directories.forEach(p=>fs.rmSync(p,{recursive:true,force:true})));

describe('Selected deployment planning and durable outcomes',()=>{
  it('matches the independent Python/CLVM bridge vector',()=>{
    expect(selectedPolicy(vector.validatorPubkeys,vector.permit.contextHash)).to.equal(vector.bridgePolicyHash);
  });
  it('matches the independent Base identity / Chia testnet11 context and bridge vector',()=>{
    const c=baseVector.context;
    const plan={environment:c.environment,network:'base',chainId:c.evmChainId,
      attestationEmitterAddress:c.emitter,permitIssuer:c.issuer,deploymentId:c.deploymentId,releaseIdentity:c.releaseIdentity};
    expect(selectedContext(plan)).to.equal(baseVector.permit.contextHash);
    expect(selectedPolicy(baseVector.validatorPubkeys,selectedContext(plan))).to.equal(baseVector.bridgePolicyHash);
    expect(baseVector.operationalEvmChainId).to.equal(84532);
  });
  it('requires an explicit network/chain pair and preserves the historical Sepolia default',async()=>{
    const legacy=await fixture(); expect(legacy.plan.network).to.equal('baseSepolia'); expect(legacy.plan.chainId).to.equal(84532);
    await rejected(()=>fixture({chainId:8453}),/selected together/);
    await rejected(()=>fixture({network:'base'}),/selected together/);
    await rejected(()=>fixture({network:'base',chainId:84532}),/identity network/);
    await rejected(()=>fixture({network:'baseSepolia',chainId:8453}),/identity network/);
    await rejected(()=>fixture({network:'ethMainnet',chainId:1}),/identity network/);
  });
  it('builds explicit Base identity transactions and a distinct testnet11 permit context without signing',async()=>{
    const f=await fixture({network:'base',chainId:8453});
    expect(validatePlan(f.plan)).to.equal(f.plan);
    const requests=await deploymentRequests(f.plan,name=>ethers.getContractFactory(name));
    expect(requests.every(tx=>tx.chainId===8453n)).to.equal(true);
    const historical={...f.plan,network:'baseSepolia',chainId:84532};
    expect(selectedContext(f.plan)).not.to.equal(selectedContext(historical));
    expect(()=>validatePlan(edit(f.plan,p=>{p.network='baseSepolia';p.chainId=84532;}))).to.throw(/permit context/);
    await rejected(()=>f.run({execute:false}),/selected identity network/);expect(f.signs()).to.equal(0);
    expect(fs.readdirSync(f.directory)).to.deep.equal([]);
  });
  it('public preview reconstructs all init code without accessing a signer or creating a journal',async()=>{
    const f=await fixture();const result=await f.run({execute:false,signerFactory:()=>{throw new Error('unexpected signer');}});
    expect(result.status).to.equal('planned');expect(fs.readdirSync(f.directory)).to.deep.equal([]);
  });
  for (const [label,change] of [
    ['chain',p=>p.chainId=8453],['null dev mode',p=>p.zkPassportDevMode=null],['host',p=>p.zkPassportDomain='solslot.com'],
    ['source set',p=>delete p.sourceShas.samuel],['release',p=>p.releaseIdentity=b32('22')],['CREATE target',p=>p.attestationEmitterAddress=p.deployer],
    ['context',p=>p.permitContextHash=b32('21')],['policy',p=>p.bridgePolicyHash=b32('23')],['nonce',p=>p.transactions.forwarder.nonce=1],
    ['fee',p=>p.transactions.forwarder.maxFeePerGas='0'],['unsupported field',p=>p.reviewEvidenceSha256='f'.repeat(64)]]) {
    it(`rejects changed ${label} before signer access`,async()=>{const f=await fixture();await rejected(()=>f.run({plan:edit(f.plan,change)}),/.+/);expect(f.signs()).to.equal(0);});
  }
  it('rejects compiled init-code drift and wrong RPC chain before signer access',async()=>{
    const f=await fixture();await rejected(()=>f.run({plan:edit(f.plan,p=>p.transactions.forwarder.initCodeHash=b32('44'))}),/init code/);
    const wrong=new Proxy(ethers.provider,{get:(t,k)=>k==='getNetwork'?async()=>({chainId:1n}):Reflect.get(t,k,t)?.bind?.(t)??Reflect.get(t,k,t)});
    await rejected(()=>f.run({provider:wrong}),/selected identity network/);expect(f.signs()).to.equal(0);
  });
  it('rejects missing root, occupied addresses, nonce conflict and insufficient maximum fees before signer access',async()=>{
    const f=await fixture();await ethers.provider.send('hardhat_setCode',[ROOT_VERIFIER,'0x']);await rejected(()=>f.run(),/root verifier/);
    await ethers.provider.send('hardhat_setCode',[ROOT_VERIFIER,'0x60006000f3']);
    await ethers.provider.send('hardhat_setCode',[f.plan.forwarderAddress,'0x00']);await rejected(()=>f.run(),/occupied/);
    await ethers.provider.send('hardhat_setCode',[f.plan.forwarderAddress,'0x']);await ethers.provider.send('hardhat_setNonce',[f.wallet.address,'0x1']);await rejected(()=>f.run(),/nonce/);
    const g=await fixture();await ethers.provider.send('hardhat_setBalance',[g.wallet.address,'0x0']);await rejected(()=>g.run(),/maximum fees/);expect(f.signs()).to.equal(0);expect(g.signs()).to.equal(0);
  });
  it('saves all signed bytes before RPC; recovers a mined timeout without resigning; produces exact schema 3',async()=>{
    const f=await fixture();let broadcastRaw;
    const timeout=new Proxy(ethers.provider,{get(t,k){if(k==='broadcastTransaction')return async raw=>{
      const journal=readCanonical(path.join(f.directory,'signed-deployments.json'));expect(journal.signed.length).to.equal(3);
      broadcastRaw=raw;await t.broadcastTransaction(raw);throw new Error('synthetic timeout after mining');};const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});
    const first=await f.run({provider:timeout});expect(first.status).to.equal('submission_unknown');expect(f.signs()).to.equal(1);
    const journalPath=path.join(f.directory,'signed-deployments.json');const bytes=fs.readFileSync(journalPath);const j=readCanonical(journalPath);expect(broadcastRaw).to.equal(j.signed[0]);
    const noKey=()=>{throw new Error('resume must not load a key');};
    expect((await f.run({signerFactory:noKey})).status).to.equal('confirming');
    for(let i=0;i<3;i++) {await networkHelpers.mine(12);const result=await f.run({signerFactory:noKey});expect(result.status).to.equal(i===2?'deployed_awaiting_independent_review':'submitted');}
    expect(fs.readFileSync(journalPath)).to.deep.equal(bytes);
    const artifact=readCanonical(path.join(f.directory,'deployment.json'));
    expect(Object.keys(artifact).sort()).to.deep.equal(['schemaVersion','protocolVersion','credentialPolicyVersion','network','chainId','sourceShas','deployer','startNonce','forwarderAddress','verifierAdapterAddress','attestationEmitterAddress','trustedDirectRelayerAddress','bridgePolicyHash','zkPassportRootVerifierAddress','zkPassportDomain','zkPassportDevMode','permitIssuer','permitContextHash','deploymentId','releaseIdentity','deploymentTransactions','runtimeCodeHashes','artifactHash'].sort());
    expect(artifact.schemaVersion).to.equal(3);expect(Object.keys(artifact.deploymentTransactions)).to.deep.equal(['attestationEmitter','forwarder','verifierAdapter']);
    const emitter=await ethers.getContractAt('SolslotZkPassportPermitEmitterV1',artifact.attestationEmitterAddress);
    expect(await emitter.permitContextHash()).to.equal(f.plan.permitContextHash);expect((await emitter.permitIssuer()).toLowerCase()).to.equal(f.plan.permitIssuer);
    expect(await emitter.bridgePolicyHash()).to.equal(f.plan.bridgePolicyHash);
    expect((await f.run({signerFactory:noKey})).artifactHash).to.equal(artifact.artifactHash);
    await rejected(()=>f.run({plan:edit(f.plan,p=>p.actionEnvelopeId='AE-SOLSLOT-DIFFERENT')}),/another plan/);
    console.log(JSON.stringify({evidence:'synthetic-local-deployment-outcome',chainId:84532,networkBroadcast:false,artifactHash:artifact.artifactHash,
      contracts:Object.fromEntries(['forwarder','verifierAdapter','attestationEmitter'].map((k,i)=>[k,{address:artifact[['forwarderAddress','verifierAdapterAddress','attestationEmitterAddress'][i]],...artifact.deploymentTransactions[k]}]))}));
  });
  it('reuses the original bytes after an unmined timeout and rejects a modified journal',async()=>{
    const f=await fixture();let raw;
    const outage=new Proxy(ethers.provider,{get(t,k){if(k==='broadcastTransaction')return async bytes=>{raw=bytes;throw new Error('offline');};const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});
    expect((await f.run({provider:outage})).status).to.equal('submission_unknown');
    const result=await f.run({signerFactory:()=>{throw new Error('no resign');}});expect(result.transactionHash).to.equal(ethers.keccak256(raw));
    const file=path.join(f.directory,'signed-deployments.json');const j=readCanonical(file);j.planHash=b32('88');fs.writeFileSync(file,stableJson(j)+'\n');
    await rejected(()=>f.run(),/another plan/);
  });
  it('blocks partial journals, stale signing locks and unsafe filesystem paths',async()=>{
    const f=await fixture();const file=path.join(f.directory,'signed-deployments.json');fs.writeFileSync(file,'{"schema":',{mode:0o600});await rejected(()=>f.run(),/.+/);expect(f.signs()).to.equal(0);
    fs.unlinkSync(file);fs.writeFileSync(path.join(f.directory,'signing.lock'),'');await rejected(()=>f.run(),/EEXIST/);
    const g=await fixture();fs.chmodSync(g.directory,0o755);await rejected(()=>g.run(),/owner-only/);expect(g.signs()).to.equal(0);
  });
  it('rejects duplicate JSON keys and unpinned plan bytes',async()=>{
    const f=await fixture();const file=path.join(f.directory,'plan.json');fs.writeFileSync(file,stableJson(f.plan)+'\n');
    expect(readCanonical(file,ethers.sha256(fs.readFileSync(file)).slice(2))).to.deep.equal(f.plan);
    expect(()=>readCanonical(file,'f'.repeat(64))).to.throw(/checksum/);
    fs.writeFileSync(file,'{"a":1,"a":1}\n');expect(()=>readCanonical(file)).to.throw(/canonical/);
  });
});
