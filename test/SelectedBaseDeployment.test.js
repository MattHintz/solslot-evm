import { expect } from 'chai';
import { network } from 'hardhat';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareSelectedPlan, runSelectedDeployment, readCanonical, ROOT_VERIFIER, CONTRACTS } from '../scripts/selected-deployment.js';

const { ethers, networkHelpers } = await network.create('selectedBaseLocal');
const vector = JSON.parse(fs.readFileSync(new URL('./fixtures/enrollment-permit-base-identity-v1.json',import.meta.url)));

describe('Base identity deployment on an isolated local 8453 chain', () => {
  it('records Base identity receipts and EIP-712 domain without switching the operational network', async () => {
    const wallet=ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send('hardhat_setBalance',[wallet.address,'0x1000000000000000000']);
    await ethers.provider.send('hardhat_setCode',[ROOT_VERIFIER,'0x60006000f3']);
    const sourceShas=Object.fromEntries(['protocol','evm','omnichain','api','legacyBackend','keyOfSolomon','samuel','customerWeb','adminPortal'].map((k,i)=>[k,(i+1).toString(16).repeat(40)]));
    const plan=await prepareSelectedPlan({network:'base',chainId:8453,environment:'production-alpha',sourceShas,
      deploymentId:'0x'+'51'.repeat(32),deployer:wallet.address.toLowerCase(),startNonce:0,
      trustedDirectRelayerAddress:ethers.Wallet.createRandom().address.toLowerCase(),
      permitIssuer:ethers.Wallet.createRandom().address.toLowerCase(),validatorPubkeys:vector.validatorPubkeys,
      rootVerifierCodeHash:ethers.keccak256('0x60006000f3'),actionEnvelopeId:'AE-SOLSLOT-SYNTHETIC-BASE-LOCAL-ONLY',
      fees:Object.fromEntries(Object.keys(CONTRACTS).map(k=>[k,{gasLimit:'5000000',maxFeePerGas:'5000000000',maxPriorityFeePerGas:'1000000000'}]))},
      name=>ethers.getContractFactory(name));
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'solslot-base-deployment-test-'));
    let signs=0;
    const run=(execute)=>runSelectedDeployment({plan,provider:ethers.provider,getFactory:name=>ethers.getContractFactory(name),
      signerFactory:async()=>{signs++;return wallet;},journalDirectory:directory,execute});
    try {
      expect((await run(false)).status).to.equal('planned');expect(signs).to.equal(0);
      expect(fs.readdirSync(directory)).to.deep.equal([]);
      expect((await run(true)).status).to.equal('submitted');
      for(let i=0;i<3;i++) {
        await networkHelpers.mine(12);
        expect((await run(true)).status).to.equal(i===2?'deployed_awaiting_independent_review':'submitted');
      }
      expect(signs).to.equal(1);
      const artifact=readCanonical(path.join(directory,'deployment.json'));
      expect(artifact.network).to.equal('base');expect(artifact.chainId).to.equal(8453);
      const emitter=await ethers.getContractAt('SolslotZkPassportPermitEmitterV1',artifact.attestationEmitterAddress);
      const domain=await emitter.eip712Domain();expect(domain.chainId).to.equal(8453n);
      expect(await emitter.permitContextHash()).to.equal(plan.permitContextHash);
      expect(vector.operationalEvmChainId).to.equal(84532);
      const journal=readCanonical(path.join(directory,'signed-deployments.json'));
      expect(journal.signed.every(raw=>ethers.Transaction.from(raw).chainId===8453n)).to.equal(true);
    } finally { fs.rmSync(directory,{recursive:true,force:true}); }
  });
});
