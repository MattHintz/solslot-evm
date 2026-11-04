import { expect } from 'chai';
import { network } from 'hardhat';

const { ethers } = await network.create();
const PARAM = 'tuple(bytes32,tuple(bytes32,bytes,bytes32[]),bytes,tuple(uint256,string,string,bool))';
const VERSION = '0x0000001400000000000000000000000000000000000000000000000000000000';
const VERSION_021 = '0x0000001500000000000000000000000000000000000000000000000000000000';
const VERSION_0211 = '0x0000001500010000000000000000000000000000000000000000000000000000';
const b32 = n => ethers.zeroPadValue(ethers.toBeHex(n), 32);
const AGE = '0100021200';
const SANCTIONS = '090021' + '11'.repeat(32) + '00';
const scope = 'vault:0x' + '22'.repeat(32);
for (const [adapterContract, version] of [
  ['TestableSolslotEligibilityVerifier', VERSION],
  ['TestableSolslotEligibilityVerifierV2', VERSION],
  ['TestableSolslotEligibilityVerifierV2', VERSION_021],
  ['TestableSolslotEligibilityVerifierV3', VERSION],
  ['TestableSolslotEligibilityVerifierV3', VERSION_021],
  ['TestableSolslotEligibilityVerifierV3', VERSION_0211],
]) describe(`${adapterContract} version ${version.slice(0, 14)}`, () => {
  function proof(committedInputs = '0x' + AGE + SANCTIONS, type = 1, proofVersion = version, nullifier = b32(42)) {
    return ethers.AbiCoder.defaultAbiCoder().encode([PARAM], [[proofVersion,
      [b32(2), '0x1234', [b32(10),b32(11),b32(1800000000),b32(12),b32(13),b32(14),b32(type),nullifier,ethers.ZeroHash]],
      committedInputs,[0,'attacker.example','different',true]]]);
  }
  async function setup() {
    const root = await (await ethers.getContractFactory('MockSolslotZkPassportRootVerifier')).deploy();
    const helper = await (await ethers.getContractFactory('MockSolslotEligibilityHelper')).deploy();
    const adapter = await (await ethers.getContractFactory(adapterContract)).deploy(await root.getAddress());
    await helper.configure(true,true,1800000000);
    await root.configure(true,b32(42),await helper.getAddress());
    return {root,helper,adapter};
  }

  it('fixes normal mode and solslot.com and preserves the exact vault scope', async () => {
    const {root,adapter} = await setup();
    expect(await adapter.domain()).to.equal('solslot.com');
    expect(await adapter.devMode()).to.equal(false);
    const config = ethers.AbiCoder.defaultAbiCoder().encode(['tuple(uint256,string,string,bool)'],[[604800,'solslot.com',scope,false]]);
    await root.requireServiceConfig(ethers.keccak256(config));
    expect((await adapter.verifyVaultProof(proof(),scope)).scopedNullifier).to.equal(b32(42));
    await expect(adapter.verifyVaultProof(proof(),scope+'00')).to.be.revertedWith('service config differs');
  });

  it('accepts either order of the two proven predicates', async () => {
    const {adapter} = await setup();
    await expect(adapter.verifyVaultProof(proof('0x'+SANCTIONS+AGE),scope)).not.to.revert(ethers);
  });

  it('rejects missing sanctions, extra disclosure, duplicates, noncanonical lengths and alternate matching modes before root calls', async () => {
    const {root,adapter} = await setup();
    await root.requireServiceConfig(b32(99));
    for (const committed of [
      AGE, SANCTIONS, AGE+AGE, SANCTIONS+SANCTIONS, AGE+SANCTIONS+'00',
      '0100021100'+SANCTIONS, '0100021300'+SANCTIONS, '0100021220'+SANCTIONS,
      AGE+'090020'+'11'.repeat(32)+'00', AGE+'090022'+'11'.repeat(32)+'00',
      AGE+'090021'+'11'.repeat(32)+'01', AGE+'090021'+'11'.repeat(32)+'02',
      AGE+'000021'+'11'.repeat(32)+'00', AGE+'080021'+'11'.repeat(32)+'00',
      AGE+SANCTIONS+'0000b4'+'01'.repeat(180), '',
    ]) await expect(adapter.verifyVaultProof(proof('0x'+committed),scope)).to.be.revertedWithCustomError(adapter,'QueryPolicyMismatch');
  });

  it('rejects an expired, revoked, unknown or wrong-list sanctions root even when the proof verifies', async () => {
    const {helper,adapter} = await setup();
    await helper.setSanctionsRootValid(false);
    await expect(adapter.verifyVaultProof(proof(),scope)).to.be.revertedWith('invalid sanctions root');
  });

  it('rejects either mock ID nullifier type', async () => {
    const {adapter} = await setup();
    for(const type of [2,3]) await expect(adapter.verifyVaultProof(proof(undefined,type),scope)).to.be.revertedWithCustomError(adapter,'MockNullifierTypeDisabled');
  });

  it('rejects unknown proof versions before external root verification', async () => {
    const {root,adapter} = await setup();
    await root.requireServiceConfig(b32(99));
    for (const other of [ethers.ZeroHash, VERSION.replace('0014', '0013'), VERSION.replace('0014', '0016'),
      '0x000000150002'+'00'.repeat(26)]) {
      expect(await adapter.supportsProofVersion(other)).to.equal(false);
      await expect(adapter.verifyVaultProof(proof(undefined,1,other),scope))
        .to.be.revertedWithCustomError(adapter,'UnsupportedProofVersion').withArgs(other);
    }
  });

  it('retains V1 version restrictions and exposes supported versions', async () => {
    const {adapter} = await setup();
    expect(await adapter.supportsProofVersion(VERSION)).to.equal(true);
    const accepts021 = adapterContract.endsWith('V2') || adapterContract.endsWith('V3');
    expect(await adapter.supportsProofVersion(VERSION_021)).to.equal(accepts021);
    if (!accepts021) await expect(adapter.verifyVaultProof(proof(undefined,1,VERSION_021),scope))
      .to.be.revertedWithCustomError(adapter,'UnsupportedProofVersion').withArgs(VERSION_021);
    const accepts0211 = adapterContract.endsWith('V3');
    expect(await adapter.supportsProofVersion(VERSION_0211)).to.equal(accepts0211);
    if (!accepts0211) await expect(adapter.verifyVaultProof(proof(undefined,1,VERSION_0211),scope))
      .to.be.revertedWithCustomError(adapter,'UnsupportedProofVersion').withArgs(VERSION_0211);
  });

  it('requires a nonzero root-verified nullifier at the reviewed tail position', async () => {
    const {root,helper,adapter} = await setup();
    await expect(adapter.verifyVaultProof(proof(undefined,1,version,b32(43)),scope))
      .to.be.revertedWithCustomError(adapter,'NullifierMismatch');
    await root.configure(true,ethers.ZeroHash,await helper.getAddress());
    await expect(adapter.verifyVaultProof(proof(undefined,1,version,ethers.ZeroHash),scope))
      .to.be.revertedWithCustomError(adapter,'NullifierMismatch');
    await expect(adapter.verifyVaultProof(proof(undefined,4),scope))
      .to.be.revertedWithCustomError(adapter,'UnsupportedNullifierType');
  });

  it('retains cryptographic verification and the age and domain checks', async () => {
    const {root,helper,adapter} = await setup();
    await root.configure(false,b32(42),await helper.getAddress());
    await expect(adapter.verifyVaultProof(proof(),scope)).to.be.revertedWithCustomError(adapter,'ProofVerificationFailed');
    await root.configure(true,b32(42),await helper.getAddress());
    await helper.configure(false,true,1800000000);
    await expect(adapter.verifyVaultProof(proof(),scope)).to.be.revertedWithCustomError(adapter,'ScopeMismatch');
    await helper.configure(true,false,1800000000);
    await expect(adapter.verifyVaultProof(proof(),scope)).to.be.revertedWithCustomError(adapter,'AgePolicyMismatch');
  });
});
