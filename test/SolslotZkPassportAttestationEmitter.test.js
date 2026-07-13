const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');

const BRIDGE_POLICY_HASH = `0x${'55'.repeat(32)}`;
const PROOF = '0x123456';

function b32(byteHex) {
  return `0x${byteHex.repeat(32)}`;
}

function binding(overrides = {}) {
  return {
    vaultLauncherId: b32('11'),
    bridgeParentId: b32('66'),
    bridgeAmount: 1,
    ...overrides,
  };
}

function proofFields(timestamp, overrides = {}) {
  return {
    scopedNullifier: b32('22'),
    nullifierType: 1,
    serviceScopeHash: b32('33'),
    serviceSubscopeHash: b32('44'),
    proofTimestamp: timestamp,
    ...overrides,
  };
}

describe('SolslotZkPassportAttestationEmitter', () => {
  async function deployFixture() {
    const [sender, forwarder] = await ethers.getSigners();
    const MockVerifier = await ethers.getContractFactory('MockSolslotZkPassportVerifierAdapter');
    const verifier = await MockVerifier.deploy();
    const Emitter = await ethers.getContractFactory('SolslotZkPassportAttestationEmitter');
    const emitter = await Emitter.deploy(
      await verifier.getAddress(),
      BRIDGE_POLICY_HASH,
      forwarder.address,
    );
    const timestamp = await time.latest();
    const fields = proofFields(timestamp);
    await verifier.setFields(fields);
    return { sender, forwarder, verifier, emitter, timestamp, fields };
  }

  it('derives every Chia commitment from verifier-returned public inputs', async () => {
    const { sender, verifier, emitter, fields } = await deployFixture();
    const enrolled = binding();
    const preview = await emitter.previewCommitments(enrolled, fields);

    await expect(emitter.verifyAndEmit(enrolled, PROOF))
      .to.emit(emitter, 'VaultAttestationVerified')
      .withArgs(
        sender.address,
        enrolled.vaultLauncherId,
        fields.scopedNullifier,
        fields.nullifierType,
        fields.serviceScopeHash,
        fields.serviceSubscopeHash,
        fields.proofTimestamp,
        preview.attestationLeafHash,
        preview.attestationRoot,
        enrolled.bridgeParentId,
        enrolled.bridgeAmount,
        preview.bridgeCoinId,
        preview.bridgeMessage,
        BRIDGE_POLICY_HASH,
        2,
      );

    expect(preview.attestationRoot).to.equal(preview.attestationLeafHash);
    expect(await emitter.consumedBridgeCoins(preview.bridgeCoinId)).to.equal(true);
    const key = await emitter.nullifierKey(enrolled.vaultLauncherId, fields.scopedNullifier);
    expect(await emitter.consumedNullifiers(key)).to.equal(true);
    expect(await verifier.requiredSubscopeHash()).to.equal(ethers.ZeroHash);
  });

  it('matches the frozen Chia v2 commitment vector byte-for-byte', async () => {
    const { emitter } = await deployFixture();
    await time.increaseTo(1_900_000_000);
    const preview = await emitter.previewCommitments(
      binding(),
      proofFields(1_900_000_000),
    );
    expect(preview.attestationLeafHash).to.equal(
      '0x649f7d41ff41ca34bf0d091ba762cefce1d545677e5aa5dfb8205fc878b84d7c',
    );
    expect(preview.bridgeCoinId).to.equal(
      '0x30c14b0547553627bde49cd6021cbddc7e0dea379ce600c8832533027612f065',
    );
    expect(preview.bridgeMessage).to.equal(
      '0xec76c723774501aa2afe0153fff45efddbdc49c69a6aa67e0f6d269b6a7e49bc',
    );
    expect(preview.validatorMessage).to.equal(
      '0x093507a5ff3da02672f47dba4aecfa76fbccbd1fcbaf5417217fe6f67b9beac0',
    );
  });

  it('binds verification to the exact vault subscope', async () => {
    const { verifier, emitter } = await deployFixture();
    const enrolled = binding();
    await verifier.setRequiredSubscope(`vault:${enrolled.vaultLauncherId}`);
    await expect(emitter.verifyAndEmit(enrolled, PROOF)).not.to.be.reverted;
  });

  it('rejects replay of the same vault-scoped nullifier', async () => {
    const { emitter } = await deployFixture();
    const enrolled = binding();
    await emitter.verifyAndEmit(enrolled, PROOF);
    await expect(emitter.verifyAndEmit(enrolled, PROOF))
      .to.be.revertedWithCustomError(emitter, 'NullifierAlreadyConsumed');
  });

  it('rejects bridge coin reuse even with a fresh nullifier', async () => {
    const { verifier, emitter, timestamp } = await deployFixture();
    const enrolled = binding();
    await emitter.verifyAndEmit(enrolled, PROOF);
    await verifier.setFields(proofFields(timestamp, { scopedNullifier: b32('99') }));
    await expect(emitter.verifyAndEmit(enrolled, PROOF))
      .to.be.revertedWithCustomError(emitter, 'BridgeCoinAlreadyConsumed');
  });

  it('permits the same anonymous nullifier to bind once to a different vault', async () => {
    const { emitter } = await deployFixture();
    await emitter.verifyAndEmit(binding(), PROOF);
    const second = binding({ vaultLauncherId: b32('77'), bridgeParentId: b32('88') });
    await expect(emitter.verifyAndEmit(second, PROOF)).not.to.be.reverted;
  });

  it('rejects stale or future proof timestamps returned by the verifier', async () => {
    const { verifier, emitter, timestamp } = await deployFixture();
    await verifier.setFields(proofFields(timestamp - 7 * 24 * 60 * 60));
    await time.increase(1);
    await expect(emitter.verifyAndEmit(binding(), PROOF))
      .to.be.revertedWithCustomError(emitter, 'StaleProofTimestamp');

    const current = await time.latest();
    await verifier.setFields(proofFields(current + 60));
    await expect(emitter.verifyAndEmit(binding(), PROOF))
      .to.be.revertedWithCustomError(emitter, 'FutureProofTimestamp');
  });

  it('rejects malformed enrollment bindings before verifier work', async () => {
    const { emitter } = await deployFixture();
    await expect(emitter.verifyAndEmit(binding({ vaultLauncherId: ethers.ZeroHash }), PROOF))
      .to.be.revertedWithCustomError(emitter, 'ZeroBytes32')
      .withArgs('vaultLauncherId');
    await expect(emitter.verifyAndEmit(binding({ bridgeAmount: 0 }), PROOF))
      .to.be.revertedWithCustomError(emitter, 'ZeroAmount')
      .withArgs('bridgeAmount');
  });

  it('executes a proof through the V2-only forwarder domain', async () => {
    const [owner, relayer] = await ethers.getSigners();
    const Forwarder = await ethers.getContractFactory('SolslotForwarder');
    const forwarder = await Forwarder.deploy();
    const MockVerifier = await ethers.getContractFactory('MockSolslotZkPassportVerifierAdapter');
    const verifier = await MockVerifier.deploy();
    const Emitter = await ethers.getContractFactory('SolslotZkPassportAttestationEmitter');
    const emitter = await Emitter.deploy(
      await verifier.getAddress(),
      BRIDGE_POLICY_HASH,
      await forwarder.getAddress(),
    );
    const timestamp = await time.latest();
    await verifier.setFields(proofFields(timestamp));

    const data = emitter.interface.encodeFunctionData('verifyAndEmit', [binding(), PROOF]);
    const nonce = await forwarder.nonces(owner.address);
    const deadline = BigInt(timestamp + 1800);
    const request = {
      from: owner.address,
      to: await emitter.getAddress(),
      value: 0n,
      gas: 1_800_000n,
      deadline,
      data,
    };
    const signature = await owner.signTypedData(
      {
        name: 'SolslotForwarder',
        version: '2',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await forwarder.getAddress(),
      },
      {
        ForwardRequest: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'gas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint48' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { ...request, nonce },
    );

    const domain = await forwarder.eip712Domain();
    expect(domain.name).to.equal('SolslotForwarder');
    expect(domain.version).to.equal('2');
    await expect(forwarder.connect(relayer).execute({ ...request, signature }))
      .to.emit(emitter, 'VaultAttestationVerified')
      .withArgs(
        owner.address,
        binding().vaultLauncherId,
        b32('22'),
        1,
        b32('33'),
        b32('44'),
        timestamp,
        anyValue,
        anyValue,
        binding().bridgeParentId,
        1,
        anyValue,
        anyValue,
        BRIDGE_POLICY_HASH,
        2,
      );
  });
});
