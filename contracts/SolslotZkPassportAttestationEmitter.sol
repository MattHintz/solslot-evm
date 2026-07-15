// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

interface ISolslotZkPassportVerifierAdapter {
    struct VerifiedProofFields {
        bytes32 scopedNullifier;
        uint16 nullifierType;
        bytes32 serviceScopeHash;
        bytes32 serviceSubscopeHash;
        uint64 proofTimestamp;
    }

    function verifyVaultProof(bytes calldata proof, string calldata expectedServiceSubscope)
        external
        view
        returns (VerifiedProofFields memory);
}

/// @notice Emits the canonical Solslot v2 credential commitments derived from a verified proof.
contract SolslotZkPassportAttestationEmitter is ERC2771Context {
    struct EnrollmentBinding {
        bytes32 vaultLauncherId;
        bytes32 bridgeParentId;
        uint64 bridgeAmount;
    }

    uint16 public constant POLICY_VERSION = 2;
    uint64 public constant MAX_PROOF_AGE_SECONDS = 7 days;
    string public constant ATTESTATION_DOMAIN = "solslot-zkpassport-vault-attestation-v2";
    bytes16 private constant HEX_SYMBOLS = "0123456789abcdef";

    ISolslotZkPassportVerifierAdapter public immutable verifier;
    bytes32 public immutable bridgePolicyHash;
    address public immutable trustedDirectRelayer;

    mapping(bytes32 nullifierKey => bool consumed) public consumedNullifiers;
    mapping(bytes32 bridgeCoinId => bool consumed) public consumedBridgeCoins;

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
    error FutureProofTimestamp(uint64 proofTimestamp, uint256 currentTimestamp);
    error UntrustedEmitterCaller(address caller);
    error NullifierAlreadyConsumed(bytes32 key);
    error BridgeCoinAlreadyConsumed(bytes32 bridgeCoinId);

    constructor(
        address verifier_,
        bytes32 bridgePolicyHash_,
        address trustedForwarder_,
        address trustedDirectRelayer_
    )
        ERC2771Context(trustedForwarder_)
    {
        if (verifier_ == address(0)) revert ZeroAddress("verifier");
        if (trustedForwarder_ == address(0)) revert ZeroAddress("trustedForwarder");
        if (trustedDirectRelayer_ == address(0)) revert ZeroAddress("trustedDirectRelayer");
        if (bridgePolicyHash_ == bytes32(0)) revert ZeroBytes32("bridgePolicyHash");
        verifier = ISolslotZkPassportVerifierAdapter(verifier_);
        bridgePolicyHash = bridgePolicyHash_;
        trustedDirectRelayer = trustedDirectRelayer_;
    }

    function verifyAndEmit(EnrollmentBinding calldata binding, bytes calldata proof) external {
        if (!isTrustedForwarder(msg.sender) && msg.sender != trustedDirectRelayer) {
            revert UntrustedEmitterCaller(msg.sender);
        }
        _validateBinding(binding);
        ISolslotZkPassportVerifierAdapter.VerifiedProofFields memory fields =
            verifier.verifyVaultProof(proof, expectedVaultSubscope(binding.vaultLauncherId));
        _validateProofFields(fields);

        (
            bytes32 attestationLeafHash,
            bytes32 attestationRoot,
            bytes32 bridgeCoinId,
            bytes32 bridgeMessage,

        ) = previewCommitments(binding, fields);

        bytes32 consumedNullifierKey = keccak256(
            abi.encode(POLICY_VERSION, binding.vaultLauncherId, fields.scopedNullifier)
        );
        if (consumedNullifiers[consumedNullifierKey]) {
            revert NullifierAlreadyConsumed(consumedNullifierKey);
        }
        if (consumedBridgeCoins[bridgeCoinId]) revert BridgeCoinAlreadyConsumed(bridgeCoinId);

        consumedNullifiers[consumedNullifierKey] = true;
        consumedBridgeCoins[bridgeCoinId] = true;

        emit VaultAttestationVerified(
            _msgSender(),
            binding.vaultLauncherId,
            fields.scopedNullifier,
            fields.nullifierType,
            fields.serviceScopeHash,
            fields.serviceSubscopeHash,
            fields.proofTimestamp,
            attestationLeafHash,
            attestationRoot,
            binding.bridgeParentId,
            binding.bridgeAmount,
            bridgeCoinId,
            bridgeMessage,
            bridgePolicyHash,
            POLICY_VERSION
        );
    }

    function previewCommitments(
        EnrollmentBinding calldata binding,
        ISolslotZkPassportVerifierAdapter.VerifiedProofFields memory fields
    )
        public
        view
        returns (
            bytes32 attestationLeafHash,
            bytes32 attestationRoot,
            bytes32 bridgeCoinId,
            bytes32 bridgeMessage,
            bytes32 validatorMessage
        )
    {
        _validateBinding(binding);
        _validateProofFields(fields);
        attestationLeafHash = _attestationLeaf(binding.vaultLauncherId, fields);
        attestationRoot = attestationLeafHash;
        bridgeCoinId = _chiaCoinId(binding.bridgeParentId, bridgePolicyHash, binding.bridgeAmount);
        bridgeMessage = _bridgeMessage(binding.vaultLauncherId, attestationRoot);
        validatorMessage = _validatorMessage(
            binding.vaultLauncherId,
            fields,
            attestationLeafHash,
            attestationRoot,
            bridgeCoinId,
            bridgeMessage
        );
    }

    function nullifierKey(bytes32 vaultLauncherId, bytes32 scopedNullifier)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(POLICY_VERSION, vaultLauncherId, scopedNullifier));
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

    function _validateBinding(EnrollmentBinding calldata binding) private pure {
        if (binding.vaultLauncherId == bytes32(0)) revert ZeroBytes32("vaultLauncherId");
        if (binding.bridgeParentId == bytes32(0)) revert ZeroBytes32("bridgeParentId");
        if (binding.bridgeAmount == 0) revert ZeroAmount("bridgeAmount");
    }

    function _validateProofFields(
        ISolslotZkPassportVerifierAdapter.VerifiedProofFields memory fields
    ) private view {
        if (fields.scopedNullifier == bytes32(0)) revert ZeroBytes32("scopedNullifier");
        if (fields.serviceScopeHash == bytes32(0)) revert ZeroBytes32("serviceScopeHash");
        if (fields.serviceSubscopeHash == bytes32(0)) revert ZeroBytes32("serviceSubscopeHash");
        if (fields.proofTimestamp == 0) revert ZeroTimestamp();
        if (fields.proofTimestamp > block.timestamp) {
            revert FutureProofTimestamp(fields.proofTimestamp, block.timestamp);
        }
        if (block.timestamp > uint256(fields.proofTimestamp) + MAX_PROOF_AGE_SECONDS) {
            revert StaleProofTimestamp(fields.proofTimestamp, block.timestamp);
        }
    }

    function _attestationLeaf(
        bytes32 vaultLauncherId,
        ISolslotZkPassportVerifierAdapter.VerifiedProofFields memory fields
    ) private pure returns (bytes32) {
        bytes32[] memory atoms = new bytes32[](8);
        atoms[0] = _atomHash(bytes(ATTESTATION_DOMAIN));
        atoms[1] = _atomHash(_clvmUint64(POLICY_VERSION));
        atoms[2] = _atomHash(abi.encodePacked(vaultLauncherId));
        atoms[3] = _atomHash(abi.encodePacked(fields.scopedNullifier));
        atoms[4] = _atomHash(_clvmUint64(fields.nullifierType));
        atoms[5] = _atomHash(abi.encodePacked(fields.serviceScopeHash));
        atoms[6] = _atomHash(abi.encodePacked(fields.serviceSubscopeHash));
        atoms[7] = _atomHash(_clvmUint64(fields.proofTimestamp));
        return _listHash(atoms);
    }

    function _bridgeMessage(bytes32 vaultLauncherId, bytes32 attestationRoot)
        private
        view
        returns (bytes32)
    {
        bytes32[] memory atoms = new bytes32[](5);
        atoms[0] = _atomHash(bytes(ATTESTATION_DOMAIN));
        atoms[1] = _atomHash(_clvmUint64(POLICY_VERSION));
        atoms[2] = _atomHash(abi.encodePacked(vaultLauncherId));
        atoms[3] = _atomHash(abi.encodePacked(attestationRoot));
        atoms[4] = _atomHash(abi.encodePacked(bridgePolicyHash));
        return _listHash(atoms);
    }

    function _validatorMessage(
        bytes32 vaultLauncherId,
        ISolslotZkPassportVerifierAdapter.VerifiedProofFields memory fields,
        bytes32 attestationLeafHash,
        bytes32 attestationRoot,
        bytes32 bridgeCoinId,
        bytes32 bridgeMessage
    ) private view returns (bytes32) {
        bytes32[] memory atoms = new bytes32[](12);
        atoms[0] = _atomHash(abi.encodePacked(bytes32(uint256(POLICY_VERSION))));
        atoms[1] = _atomHash(abi.encodePacked(vaultLauncherId));
        atoms[2] = _atomHash(abi.encodePacked(attestationRoot));
        atoms[3] = _atomHash(abi.encodePacked(bridgePolicyHash));
        atoms[4] = _atomHash(abi.encodePacked(bridgeCoinId));
        atoms[5] = _atomHash(abi.encodePacked(bridgeMessage));
        atoms[6] = _atomHash(abi.encodePacked(attestationLeafHash));
        atoms[7] = _atomHash(abi.encodePacked(fields.scopedNullifier));
        atoms[8] = _atomHash(abi.encodePacked(bytes32(uint256(fields.nullifierType))));
        atoms[9] = _atomHash(abi.encodePacked(fields.serviceScopeHash));
        atoms[10] = _atomHash(abi.encodePacked(fields.serviceSubscopeHash));
        atoms[11] = _atomHash(abi.encodePacked(bytes32(uint256(fields.proofTimestamp))));
        return _listHash(atoms);
    }

    function _atomHash(bytes memory atom) private pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), atom));
    }

    function _listHash(bytes32[] memory atomHashes) private pure returns (bytes32 acc) {
        acc = _atomHash(new bytes(0));
        for (uint256 i = atomHashes.length; i > 0; i--) {
            acc = sha256(abi.encodePacked(bytes1(0x02), atomHashes[i - 1], acc));
        }
    }

    function _chiaCoinId(bytes32 parentCoinInfo, bytes32 puzzleHash, uint64 amount)
        private
        pure
        returns (bytes32)
    {
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
