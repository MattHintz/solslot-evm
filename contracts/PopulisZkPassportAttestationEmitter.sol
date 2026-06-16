// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

interface IZkPassportVerifierAdapter {
    struct VaultAttestation {
        bytes32 vaultLauncherId;
        bytes32 scopedNullifier;
        uint16 nullifierType;
        bytes32 serviceScopeHash;
        bytes32 serviceSubscopeHash;
        uint64 proofTimestamp;
        bytes32 attestationLeafHash;
        bytes32 attestationRoot;
        bytes32 bridgeParentId;
        uint64 bridgeAmount;
        bytes32 bridgeCoinId;
        bytes32 bridgeMessage;
    }

    function verifyVaultAttestation(
        bytes calldata proof,
        VaultAttestation calldata attestation,
        bytes32 bridgePolicyHash,
        string calldata expectedServiceSubscope
    ) external returns (bool);
}

contract PopulisZkPassportAttestationEmitter is ERC2771Context {
    uint16 public constant POLICY_VERSION = 1;
    uint64 public constant MAX_PROOF_AGE_SECONDS = 7 days;
    bytes16 private constant HEX_SYMBOLS = "0123456789abcdef";

    IZkPassportVerifierAdapter public immutable verifier;
    bytes32 public immutable bridgePolicyHash;

    event VaultAttestationVerified(
        address indexed sender,
        bytes32 indexed vaultLauncherId,
        bytes32 indexed scopedNullifier,
        uint16 nullifierType,
        bytes32 serviceScopeHash,
        bytes32 serviceSubscopeHash,
        uint64 proofTimestamp,
        bytes32 attestationLeafHash,
        bytes32 attestationRoot,
        bytes32 bridgeParentId,
        uint64 bridgeAmount,
        bytes32 bridgeCoinId,
        bytes32 bridgeMessage,
        bytes32 bridgePolicyHash,
        uint16 policyVersion
    );

    error ZeroAddress(string field);
    error ZeroBytes32(string field);
    error ZeroAmount(string field);
    error ZeroTimestamp();
    error StaleProofTimestamp(uint64 proofTimestamp, uint256 currentTimestamp);
    error InvalidZkPassportProof();
    error InvalidBridgeCoinId(bytes32 expected, bytes32 actual);

    constructor(
        address verifier_,
        bytes32 bridgePolicyHash_,
        address trustedForwarder_
    ) ERC2771Context(trustedForwarder_) {
        if (verifier_ == address(0)) revert ZeroAddress("verifier");
        if (bridgePolicyHash_ == bytes32(0)) revert ZeroBytes32("bridgePolicyHash");
        verifier = IZkPassportVerifierAdapter(verifier_);
        bridgePolicyHash = bridgePolicyHash_;
    }

    function verifyAndEmit(
        IZkPassportVerifierAdapter.VaultAttestation calldata attestation,
        bytes calldata proof
    ) external {
        _validateAttestation(attestation);
        bool ok = verifier.verifyVaultAttestation(
            proof,
            attestation,
            bridgePolicyHash,
            expectedVaultSubscope(attestation.vaultLauncherId)
        );
        if (!ok) revert InvalidZkPassportProof();

        emit VaultAttestationVerified(
            _msgSender(),
            attestation.vaultLauncherId,
            attestation.scopedNullifier,
            attestation.nullifierType,
            attestation.serviceScopeHash,
            attestation.serviceSubscopeHash,
            attestation.proofTimestamp,
            attestation.attestationLeafHash,
            attestation.attestationRoot,
            attestation.bridgeParentId,
            attestation.bridgeAmount,
            attestation.bridgeCoinId,
            attestation.bridgeMessage,
            bridgePolicyHash,
            POLICY_VERSION
        );
    }

    function validatorMessageFields(
        IZkPassportVerifierAdapter.VaultAttestation calldata attestation
    ) external view returns (bytes32[] memory) {
        _validateAttestation(attestation);
        return _validatorMessageFields(attestation);
    }

    function expectedVaultSubscope(bytes32 vaultLauncherId) public pure returns (string memory) {
        if (vaultLauncherId == bytes32(0)) revert ZeroBytes32("vaultLauncherId");
        bytes memory out = new bytes(72);
        out[0] = "v";
        out[1] = "a";
        out[2] = "u";
        out[3] = "l";
        out[4] = "t";
        out[5] = ":";
        out[6] = "0";
        out[7] = "x";
        bytes memory launcher = abi.encodePacked(vaultLauncherId);
        for (uint256 i = 0; i < 32; i++) {
            uint8 value = uint8(launcher[i]);
            out[8 + i * 2] = HEX_SYMBOLS[value >> 4];
            out[9 + i * 2] = HEX_SYMBOLS[value & 0x0f];
        }
        return string(out);
    }

    function _validatorMessageFields(
        IZkPassportVerifierAdapter.VaultAttestation calldata attestation
    ) private view returns (bytes32[] memory fields) {
        fields = new bytes32[](12);
        fields[0] = bytes32(uint256(POLICY_VERSION));
        fields[1] = attestation.vaultLauncherId;
        fields[2] = attestation.attestationRoot;
        fields[3] = bridgePolicyHash;
        fields[4] = attestation.bridgeCoinId;
        fields[5] = attestation.bridgeMessage;
        fields[6] = attestation.attestationLeafHash;
        fields[7] = attestation.scopedNullifier;
        fields[8] = bytes32(uint256(attestation.nullifierType));
        fields[9] = attestation.serviceScopeHash;
        fields[10] = attestation.serviceSubscopeHash;
        fields[11] = bytes32(uint256(attestation.proofTimestamp));
    }

    function _validateAttestation(
        IZkPassportVerifierAdapter.VaultAttestation calldata attestation
    ) private view {
        if (attestation.vaultLauncherId == bytes32(0)) revert ZeroBytes32("vaultLauncherId");
        if (attestation.scopedNullifier == bytes32(0)) revert ZeroBytes32("scopedNullifier");
        if (attestation.serviceScopeHash == bytes32(0)) revert ZeroBytes32("serviceScopeHash");
        if (attestation.serviceSubscopeHash == bytes32(0)) revert ZeroBytes32("serviceSubscopeHash");
        if (attestation.proofTimestamp == 0) revert ZeroTimestamp();
        if (block.timestamp > uint256(attestation.proofTimestamp) + MAX_PROOF_AGE_SECONDS) {
            revert StaleProofTimestamp(attestation.proofTimestamp, block.timestamp);
        }
        if (attestation.attestationLeafHash == bytes32(0)) revert ZeroBytes32("attestationLeafHash");
        if (attestation.attestationRoot == bytes32(0)) revert ZeroBytes32("attestationRoot");
        if (attestation.bridgeParentId == bytes32(0)) revert ZeroBytes32("bridgeParentId");
        if (attestation.bridgeAmount == 0) revert ZeroAmount("bridgeAmount");
        if (attestation.bridgeCoinId == bytes32(0)) revert ZeroBytes32("bridgeCoinId");
        bytes32 expectedBridgeCoinId = _chiaCoinId(
            attestation.bridgeParentId,
            bridgePolicyHash,
            attestation.bridgeAmount
        );
        if (attestation.bridgeCoinId != expectedBridgeCoinId) {
            revert InvalidBridgeCoinId(expectedBridgeCoinId, attestation.bridgeCoinId);
        }
        if (attestation.bridgeMessage == bytes32(0)) revert ZeroBytes32("bridgeMessage");
    }

    function _chiaCoinId(bytes32 parentCoinInfo, bytes32 puzzleHash, uint64 amount) private pure returns (bytes32) {
        return sha256(abi.encodePacked(parentCoinInfo, puzzleHash, _clvmUint64(amount)));
    }

    function _clvmUint64(uint64 value) private pure returns (bytes memory) {
        if (value == 0) return new bytes(0);
        uint64 remaining = value;
        uint256 length = 0;
        while (remaining != 0) {
            length++;
            remaining >>= 8;
        }
        bool needsLeadingZero = ((value >> ((length - 1) * 8)) & 0x80) != 0;
        bytes memory out = new bytes(length + (needsLeadingZero ? 1 : 0));
        uint256 offset = needsLeadingZero ? 1 : 0;
        for (uint256 i = 0; i < length; i++) {
            out[offset + length - 1 - i] = bytes1(uint8(value >> (i * 8)));
        }
        return out;
    }
}
