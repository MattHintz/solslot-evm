import { expect } from 'chai';
import { network } from 'hardhat';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareEligibilityPlan, eligibilityBridgePolicy, ELIGIBILITY_BRIDGE_MODULE_HASH,
  ELIGIBILITY_CONTRACTS, ELIGIBILITY_POLICY, ROOT_VERIFIER, runSelectedDeployment,
  readCanonical, validatePlan, hashObject, deploymentRequests } from '../scripts/selected-deployment.js';

const {ethers,networkHelpers}=await network.create('eligibilityLocal');
const vector=JSON.parse(fs.readFileSync(new URL('./fixtures/sepolia-eligibility-bridge.json',import.meta.url)));
const directories=[];
after(()=>directories.forEach(p=>fs.rmSync(p,{recursive:true,force:true})));
async function fixture() {
  const wallet=ethers.Wallet.createRandom().connect(ethers.provider);
  await ethers.provider.send('hardhat_setBalance',[wallet.address,'0x1000000000000000000']);
  await ethers.provider.send('hardhat_setCode',[ROOT_VERIFIER,'0x60006000f3']);
  const sourceShas=Object.fromEntries(['protocol','evm','omnichain','api','legacyBackend','keyOfSolomon','samuel','customerWeb','adminPortal'].map((k,i)=>[k,(i+1).toString(16).repeat(40)]));
  const plan=await prepareEligibilityPlan({environment:'production-alpha',network:'ethSepolia',chainId:11155111,
    sourceShas,deploymentId:'0x'+'61'.repeat(32),deployer:wallet.address.toLowerCase(),startNonce:0,
    trustedDirectRelayerAddress:ethers.Wallet.createRandom().address.toLowerCase(),validatorPubkeys:vector.validatorPubkeys,
    rootVerifierCodeHash:ethers.keccak256('0x60006000f3'),actionEnvelopeId:'AE-SOLSLOT-ELIGIBILITY-LOCAL-TEST',
    fees:Object.fromEntries(Object.keys(ELIGIBILITY_CONTRACTS).map(k=>[k,{gasLimit:'5000000',maxFeePerGas:'5000000000',maxPriorityFeePerGas:'1000000000'}]))},
    name=>ethers.getContractFactory(name));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'solslot-eligibility-test-'));directories.push(directory);
  let signs=0;
  const run=(extra={})=>runSelectedDeployment({plan,provider:ethers.provider,getFactory:name=>ethers.getContractFactory(name),
    signerFactory:async()=>{signs++;return wallet;},journalDirectory:directory,execute:true,...extra});
  return {plan,directory,run,signs:()=>signs};
}
function edit(plan,change) { const p=structuredClone(plan);change(p);delete p.planHash;p.planHash=hashObject(p);return p; }
async function rejects(action,pattern) {let error;try {await action();}catch(e){error=e;}expect(error?.message).to.match(pattern);}

describe('Sepolia full-testnet eligibility deployment',()=>{
  it('reconstructs the independently derived Chia bridge policy for all three validators',()=>{
    expect(ELIGIBILITY_BRIDGE_MODULE_HASH).to.equal(vector.moduleHash);
    expect(eligibilityBridgePolicy(vector.validatorPubkeys)).to.equal(vector.policyHash);
  });
  it('previews exact age + sanctions init code without key access',async()=>{
    const f=await fixture();
    expect(f.plan.identityPolicy).to.deep.equal(ELIGIBILITY_POLICY);
    expect(f.plan).not.to.have.property('permitIssuer');
    expect((await deploymentRequests(f.plan,name=>ethers.getContractFactory(name))).every(tx=>tx.chainId===11155111n)).to.equal(true);
    expect((await f.run({execute:false})).status).to.equal('planned');
    expect(f.signs()).to.equal(0);expect(fs.readdirSync(f.directory)).to.deep.equal([]);
  });
  for (const [name,change] of [
    ['Base payment chain',p=>{p.chainId=8453;p.network='base';}],
    ['staging domain',p=>{p.environment='staging-alpha';p.zkPassportDomain='staging.solslot.com';}],
    ['mock passport mode',p=>p.zkPassportDevMode=true],
    ['missing sanctions',p=>delete p.identityPolicy.sanctions],
    ['partial sanctions lists',p=>p.identityPolicy.sanctions.lists='ofac'],
    ['age-only adapter',p=>p.identityPolicy.adapter='SolslotZkPassportVerifierAdapter'],
    ['permit activation',p=>p.permitIssuer=p.deployer],
    ['another bridge module',p=>p.bridgeModuleHash='0x'+'13'.repeat(32)],
  ]) it(`rejects ${name} before signing`,async()=>{
    const f=await fixture();await rejects(()=>f.run({plan:edit(f.plan,change)}),/.+/);expect(f.signs()).to.equal(0);
  });
  it('retains signed transactions across an ambiguous push and seals schema 2 evidence',async()=>{
    const f=await fixture();
    const timeout=new Proxy(ethers.provider,{get(t,k){if(k==='broadcastTransaction')return async raw=>{
      const saved=readCanonical(path.join(f.directory,'signed-deployments.json'));
      expect(saved.signed.length).to.equal(3);await t.broadcastTransaction(raw);throw new Error('synthetic timeout');
    };const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});
    expect((await f.run({provider:timeout})).status).to.equal('submission_unknown');
    const before=fs.readFileSync(path.join(f.directory,'signed-deployments.json'));
    const noKey=()=>{throw new Error('no new signatures');};
    for(let i=0;i<3;i++) {await networkHelpers.mine(12);expect((await f.run({signerFactory:noKey})).status).to.equal(i===2?'deployed_awaiting_independent_review':'submitted');}
    expect(fs.readFileSync(path.join(f.directory,'signed-deployments.json'))).to.deep.equal(before);
    const artifact=readCanonical(path.join(f.directory,'deployment.json'));
    expect(artifact.schemaVersion).to.equal(2);expect(artifact.chainId).to.equal(11155111);
    expect(artifact.identityPolicy).to.deep.equal(ELIGIBILITY_POLICY);
    expect(artifact).not.to.have.property('permitIssuer');
    const adapter=await ethers.getContractAt('SolslotZkPassportEligibilityVerifierV1',artifact.verifierAdapterAddress);
    expect(await adapter.domain()).to.equal('solslot.com');expect(await adapter.devMode()).to.equal(false);
    expect(await adapter.SANCTIONS_STRICT()).to.equal(false);
    const emitter=await ethers.getContractAt('SolslotZkPassportAttestationEmitter',artifact.attestationEmitterAddress);
    expect(await emitter.bridgePolicyHash()).to.equal(vector.policyHash);
    expect((await f.run({signerFactory:noKey})).artifactHash).to.equal(artifact.artifactHash);
  });
});
