import { expect } from 'chai';
import { network } from 'hardhat';

const { ethers } = await network.create();

const PARAM_TYPE =
  'tuple(bytes32 version, tuple(bytes32 vkeyHash, bytes proof, bytes32[] publicInputs) proofVerificationData, bytes committedInputs, tuple(uint256 validityPeriodInSeconds, string domain, string scope, bool devMode) serviceConfig)';

function b32(value) {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

function encodedProof({ timestamp = 1_800_000_000n, nullifierType = 1n, nullifier = b32(42) } = {}) {
  const inputs = [
    b32(10),
    b32(11),
    b32(timestamp),
    b32(12),
    b32(13),
    b32(14),
    b32(nullifierType),
    nullifier,
    ethers.ZeroHash,
  ];
  return {
    encoded: ethers.AbiCoder.defaultAbiCoder().encode(
      [PARAM_TYPE],
      [[b32(1), [b32(2), '0x1234', inputs], '0xabcd', [0, 'wrong', 'wrong', false]]],
    ),
    inputs,
  };
}

describe('SolslotZkPassportVerifierAdapter', () => {
  async function deployFixture(devMode = true) {
    const Root = await ethers.getContractFactory('MockSolslotZkPassportRootVerifier');
    const root = await Root.deploy();
    const Helper = await ethers.getContractFactory('MockSolslotZkPassportVerifierHelper');
    const helper = await Helper.deploy();
    const Adapter = await ethers.getContractFactory('TestableSolslotZkPassportVerifierAdapter');
    const adapter = await Adapter.deploy('staging.solslot.com', devMode, await root.getAddress());
    const proof = encodedProof();
    await helper.configure(true, true, 1_800_000_000n);
    await root.configure(true, b32(42), await helper.getAddress());
    return { root, helper, adapter, proof };
  }

  it('returns timestamp, scope, nullifier type, and nullifier from verified public inputs', async () => {
    const { adapter, proof } = await deployFixture();
    const fields = await adapter.verifyVaultProof(proof.encoded, `vault:0x${'11'.repeat(32)}`);
    expect(fields.scopedNullifier).to.equal(b32(42));
    expect(fields.nullifierType).to.equal(1);
    expect(fields.serviceScopeHash).to.equal(b32(12));
    expect(fields.serviceSubscopeHash).to.equal(b32(13));
    expect(fields.proofTimestamp).to.equal(1_800_000_000n);
  });

  it('requires the exact proof scope and alpha 18+ committed input', async () => {
    const { helper, adapter, proof } = await deployFixture();
    await helper.configure(false, true, 1_800_000_000n);
    await expect(adapter.verifyVaultProof(proof.encoded, 'vault:0x01'))
      .to.be.revertedWithCustomError(adapter, 'ScopeMismatch');

    await helper.configure(true, false, 1_800_000_000n);
    await expect(adapter.verifyVaultProof(proof.encoded, 'vault:0x01'))
      .to.be.revertedWithCustomError(adapter, 'AgePolicyMismatch')
      .withArgs(18);
  });

  it('rejects a root-verifier identifier that differs from the proof nullifier', async () => {
    const { root, helper, adapter, proof } = await deployFixture();
    await root.configure(true, b32(99), await helper.getAddress());
    await expect(adapter.verifyVaultProof(proof.encoded, 'vault:0x01'))
      .to.be.revertedWithCustomError(adapter, 'NullifierMismatch')
      .withArgs(b32(99), b32(42));
  });

  it('rejects helper timestamps that do not equal the public input', async () => {
    const { helper, adapter, proof } = await deployFixture();
    await helper.configure(true, true, 1_800_000_001n);
    await expect(adapter.verifyVaultProof(proof.encoded, 'vault:0x01'))
      .to.be.revertedWithCustomError(adapter, 'InvalidPublicInputs');
  });

  it('rejects nullifier types that cannot fit the credential schema', async () => {
    const { root, helper, adapter } = await deployFixture();
    const proof = encodedProof({ nullifierType: 65_536n });
    await root.configure(true, b32(42), await helper.getAddress());
    await expect(adapter.verifyVaultProof(proof.encoded, 'vault:0x01'))
      .to.be.revertedWithCustomError(adapter, 'NullifierTypeOverflow')
      .withArgs(65_536);
  });

  it('rejects nullifier modes outside the official zkPassport enum', async () => {
    const { root, helper, adapter } = await deployFixture();
    const proof = encodedProof({ nullifierType: 4n });
    await root.configure(true, b32(42), await helper.getAddress());
    await expect(adapter.verifyVaultProof(proof.encoded, 'vault:0x01'))
      .to.be.revertedWithCustomError(adapter, 'UnsupportedNullifierType')
      .withArgs(4);
  });

  it('rejects mock nullifier modes outside the explicit Alpha dev policy', async () => {
    const { root, helper, adapter } = await deployFixture(false);
    const proof = encodedProof({ nullifierType: 3n });
    await root.configure(true, b32(42), await helper.getAddress());
    await expect(adapter.verifyVaultProof(proof.encoded, 'vault:0x01'))
      .to.be.revertedWithCustomError(adapter, 'MockNullifierTypeDisabled')
      .withArgs(3);
  });
});
