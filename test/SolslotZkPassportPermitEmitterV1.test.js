import { expect } from 'chai';
import { network } from 'hardhat';
import { readFileSync } from 'node:fs';
const vector = JSON.parse(readFileSync(new URL('./fixtures/enrollment-permit-v1.json', import.meta.url)));
const { ethers, networkHelpers } = await network.create();
const { time } = networkHelpers;
const types = { EnrollmentPermit: [{ name: 'permitHash', type: 'bytes32' }] };
const b32 = (x) => `0x${x.repeat(32)}`;

async function fixture() {
  const [relayer, owner, issuer, outsider] = await ethers.getSigners();
  const forwarder = await (await ethers.getContractFactory('SolslotForwarder')).deploy();
  const verifier = await (await ethers.getContractFactory('MockSolslotZkPassportVerifierAdapter')).deploy();
  const emitter = await (await ethers.getContractFactory('SolslotZkPassportPermitEmitterV1')).deploy(
    await verifier.getAddress(), vector.bridgePolicyHash, await forwarder.getAddress(), relayer.address,
    issuer.address, vector.permit.contextHash);
  const now = await time.latest();
  const fields = { ...vector.fields, proofTimestamp: now };
  await verifier.setFields(fields);
  const permit = { ...vector.permit, issuedAt: now, expiresAt: now + 3600 };
  const domain = { name: 'SolslotEnrollmentPermit', version: '1',
    chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await emitter.getAddress() };
  const sign = async (p = permit, who = issuer, d = domain) => who.signTypedData(d, types, { permitHash: await emitter.permitHash(p) });
  const send = async (p = permit, sig) => emitter.verifyAndEmitWithPermit(vector.binding, p, sig ?? await sign(p), '0x123456');
  return { relayer, owner, issuer, outsider, forwarder, verifier, emitter, permit, domain, fields, sign, send };
}

describe('SolslotZkPassportPermitEmitterV1', () => {
  it('matches Python/CLVM permit and validator preimages without changing V2 roots', async () => {
    const { emitter } = await fixture();
    expect(await emitter.permitHash(vector.permit)).to.equal(vector.permitHash);
    expect(await emitter.permitValidatorMessage(vector.legacyValidatorMessage, vector.permitHash)).to.equal(vector.validatorMessage);
  });
  it('matches the Base identity vector and keeps the EIP-712 permit distinct from Base Sepolia', async () => {
    const baseVector=JSON.parse(readFileSync(new URL('./fixtures/enrollment-permit-base-identity-v1.json',import.meta.url)));
    const { emitter } = await fixture();
    expect(await emitter.permitHash(baseVector.permit)).to.equal(baseVector.permitHash);
    expect(await emitter.permitValidatorMessage(baseVector.legacyValidatorMessage,baseVector.permitHash)).to.equal(baseVector.validatorMessage);
    const {domain,message}=baseVector.permitSigningTypedData;
    expect(domain.chainId).to.equal(8453);
    expect(ethers.TypedDataEncoder.hash(domain,types,message)).not.to.equal(
      ethers.TypedDataEncoder.hash({...domain,chainId:84532},types,message));
  });
  it('rejects stale and future proof timestamps without consuming the permit or bridge', async () => {
    const f=await fixture();
    for (const timestamp of [f.fields.proofTimestamp-7*24*60*60-1, f.fields.proofTimestamp+3600]) {
      await f.verifier.setFields({...f.fields,proofTimestamp:timestamp});
      await expect(f.send()).to.be.revertedWithCustomError(f.emitter,
        timestamp<f.fields.proofTimestamp ? 'StaleProofTimestamp' : 'FutureProofTimestamp');
      expect(await f.emitter.consumedPermits(f.permit.permitId)).to.equal(false);
      expect(await f.emitter.consumedBridgeCoins(f.permit.bridgeCoinId)).to.equal(false);
    }
  });

  it('commits both events and permanently consumes permit and bridge in direct BLS relay', async () => {
    const { emitter, permit, send } = await fixture();
    await expect(send()).to.emit(emitter, 'EnrollmentPermitConsumed').and.to.emit(emitter, 'VaultAttestationVerified');
    expect(await emitter.consumedPermits(permit.permitId)).to.equal(true);
    expect(await emitter.consumedBridgeCoins(permit.bridgeCoinId)).to.equal(true);
    await expect(send()).to.be.revertedWithCustomError(emitter, 'EnrollmentPermitAlreadyConsumed');
  });

  for (const delta of [0, 1, 7200]) {
    it(`rejects direct execution at expiry + ${delta} seconds`, async () => {
      const { emitter, permit, sign, send } = await fixture();
      const signature = await sign();
      await time.setNextBlockTimestamp(permit.expiresAt + delta);
      await expect(send(permit, signature)).to.be.revertedWithCustomError(emitter, 'EnrollmentPermitNotLive');
      expect(await emitter.consumedBridgeCoins(permit.bridgeCoinId)).to.equal(false);
    });
  }
  it('accepts execution one second before expiry', async () => {
    const { permit, sign, send } = await fixture();
    const signature = await sign();
    await time.setNextBlockTimestamp(permit.expiresAt - 1);
    await expect(send(permit, signature)).not.to.revert(ethers);
  });

  for (const [field, value] of [['permitId',b32('55')], ['currentVaultCoinId',b32('56')],
    ['ownerKeyHash',b32('57')], ['issuedAt',1900000000], ['expiresAt',1900003600]]) {
    it(`rejects mutation of issuer-signed ${field}`, async () => {
      const { permit, sign, send } = await fixture();
      await expect(send({ ...permit, [field]: value }, await sign())).to.revert(ethers);
    });
  }

  it('rejects forged issuers, wrong chain/domain, wrong context, and a legacy selector', async () => {
    const { emitter, permit, sign, send, outsider, domain } = await fixture();
    await expect(send(permit, await sign(permit, outsider))).to.be.revertedWithCustomError(emitter, 'InvalidEnrollmentPermit');
    await expect(send(permit, await sign(permit, undefined, { ...domain, chainId: 8453 }))).to.be.revertedWithCustomError(emitter, 'InvalidEnrollmentPermit');
    await expect(send({ ...permit, contextHash: b32('58') })).to.be.revertedWithCustomError(emitter, 'InvalidEnrollmentPermit');
    const legacy = new ethers.Interface(['function verifyAndEmit((bytes32 vaultLauncherId,bytes32 bridgeParentId,uint64 bridgeAmount),bytes)']);
    const [caller] = await ethers.getSigners();
    await expect(caller.sendTransaction({ to: await emitter.getAddress(), data: legacy.encodeFunctionData('verifyAndEmit', [vector.binding, '0x123456']) })).to.revert(ethers);
  });

  async function forward(f, permit, issuerSignature, from = f.owner) {
    const request = { from: from.address, to: await f.emitter.getAddress(), value: 0n, gas: 2_500_000n,
      deadline: BigInt(permit.expiresAt + 3600),
      data: f.emitter.interface.encodeFunctionData('verifyAndEmitWithPermit', [vector.binding, permit, issuerSignature, '0x123456']) };
    const signature = await from.signTypedData({ name: 'SolslotForwarder', version: '2',
      chainId: f.domain.chainId, verifyingContract: await f.forwarder.getAddress() },
    { ForwardRequest: [{name:'from',type:'address'}, {name:'to',type:'address'}, {name:'value',type:'uint256'},
      {name:'gas',type:'uint256'}, {name:'nonce',type:'uint256'}, {name:'deadline',type:'uint48'}, {name:'data',type:'bytes'}] },
    { ...request, nonce: await f.forwarder.nonces(from.address) });
    return f.forwarder.connect(f.relayer).execute({ ...request, signature });
  }

  it('authorizes forwarded EVM owner and rejects a different owner', async () => {
    const f = await fixture();
    const p = { ...f.permit, ownerAuthType: 2, ownerKeyHash: ethers.sha256(f.owner.address) };
    const sig = await f.sign(p);
    await expect(forward(f, p, sig, f.outsider)).to.revert(ethers);
    await expect(forward(f, p, sig)).to.emit(f.emitter, 'EnrollmentPermitConsumed');
  });

  it('public forwarder cannot extend a deadline or invent issuer authority', async () => {
    const f = await fixture();
    const p = { ...f.permit, ownerAuthType: 2, ownerKeyHash: ethers.sha256(f.owner.address) };
    const sig = await f.sign(p);
    await expect(forward(f, { ...p, expiresAt: p.expiresAt-1 }, sig)).to.revert(ethers);
    await expect(forward(f, p, await f.sign(p, f.owner))).to.revert(ethers);
    await time.increaseTo(p.expiresAt);
    await expect(forward(f, p, sig)).to.revert(ethers);
  });

  it('retains consumed bridge inputs even with another issuer-approved permit', async () => {
    const f = await fixture(); await f.send();
    await f.verifier.setFields({ ...f.fields, scopedNullifier: b32('99') });
    await expect(f.send({ ...f.permit, permitId: b32('98') })).to.be.revertedWithCustomError(f.emitter, 'BridgeCoinAlreadyConsumed');
  });
});
