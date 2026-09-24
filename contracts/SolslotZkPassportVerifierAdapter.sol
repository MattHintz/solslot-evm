// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ISolslotZkPassportVerifierAdapter} from "./SolslotZkPassportAttestationEmitter.sol";

struct SolslotProofVerificationData {
    bytes32 vkeyHash;
    bytes proof;
    bytes32[] publicInputs;
}

struct SolslotServiceConfig {
    uint256 validityPeriodInSeconds;
    string domain;
    string scope;
    bool devMode;
}

struct SolslotProofVerificationParams {
    bytes32 version;
    SolslotProofVerificationData proofVerificationData;
    bytes committedInputs;
    SolslotServiceConfig serviceConfig;
}

interface ISolslotZkPassportRootVerifier {
    function verify(SolslotProofVerificationParams calldata params)
        external
        view
        returns (bool valid, bytes32 uniqueIdentifier, address helper);
}

interface ISolslotZkPassportVerifierHelper {
    function verifyScopes(
        bytes32[] calldata publicInputs,
        string calldata domain,
        string calldata scope
    ) external pure returns (bool);

    function getProofTimestamp(bytes32[] calldata publicInputs)
        external
        pure
        returns (uint256);

    function isAgeAboveOrEqual(uint8 minAge, bytes calldata committedInputs)
        external
        pure
        returns (bool);
}

/// @notice Verifies the 18+ Solslot alpha policy and returns only proof-derived fields.
contract SolslotZkPassportVerifierAdapter is ISolslotZkPassportVerifierAdapter {
    // Base's deployed 0.20.0 subverifier uses the three-field nullifier tail
    // from zkpassport-packages ada23cd921781fc3670a6bbae4d31538ce4281b9.
    // Older deployed versions use a different layout. New versions require
    // an explicit compatibility review; the root's admin/registry trust stays upstream.
    bytes32 public constant ACCEPTED_PROOF_VERSION =
        0x0000001400000000000000000000000000000000000000000000000000000000;
    address public constant ZKPASSPORT_ROOT_VERIFIER =
        0x1D000001000EFD9a6371f4d90bB8920D5431c0D8;
    uint256 public constant DEFAULT_VALIDITY_SECONDS = 7 days;
    uint8 public constant MINIMUM_AGE = 18;

    string public domain;
    bool public immutable devMode;

    error EmptyProof();
    error ProofVerificationFailed();
    error InvalidHelperAddress();
    error InvalidPublicInputs();
    error UnsupportedProofVersion(bytes32 version);
    error QueryPolicyMismatch();
    error ScopeMismatch(string expected);
    error AgePolicyMismatch(uint8 expectedMinimumAge);
    error ProofTimestampOverflow(uint256 value);
    error NullifierTypeOverflow(uint256 value);
    error UnsupportedNullifierType(uint256 value);
    error MockNullifierTypeDisabled(uint256 value);
    error NullifierMismatch(bytes32 verifierValue, bytes32 publicInputValue);

    constructor(string memory domain_, bool devMode_) {
        require(bytes(domain_).length > 0, "Solslot verifier: empty domain");
        domain = domain_;
        devMode = devMode_;
    }

    function verifyVaultProof(bytes calldata proof, string calldata expectedServiceSubscope)
        external
        view
        virtual
        override
        returns (VerifiedProofFields memory fields)
    {
        if (proof.length == 0) revert EmptyProof();
        SolslotProofVerificationParams memory params =
            abi.decode(proof, (SolslotProofVerificationParams));
        if (params.version != ACCEPTED_PROOF_VERSION) {
            revert UnsupportedProofVersion(params.version);
        }
        // AGE (1), two-byte payload length (2), minimum age (18), no upper
        // bound (0). Reject all extra disclosure or bind records before the
        // external verifier call. The root still checks this preimage against
        // the cryptographically proven parameter commitment.
        _validateCommittedInputs(params.committedInputs);
        bytes32[] memory publicInputs = params.proofVerificationData.publicInputs;
        if (publicInputs.length < 8) revert InvalidPublicInputs();

        params.serviceConfig.domain = domain;
        params.serviceConfig.scope = expectedServiceSubscope;
        params.serviceConfig.devMode = devMode;
        params.serviceConfig.validityPeriodInSeconds = DEFAULT_VALIDITY_SECONDS;

        (bool valid, bytes32 uniqueIdentifier, address helperAddress) =
            ISolslotZkPassportRootVerifier(_rootVerifierAddress()).verify(params);
        if (!valid) revert ProofVerificationFailed();
        if (helperAddress == address(0)) revert InvalidHelperAddress();

        ISolslotZkPassportVerifierHelper helper =
            ISolslotZkPassportVerifierHelper(helperAddress);
        if (!helper.verifyScopes(publicInputs, domain, expectedServiceSubscope)) {
            revert ScopeMismatch(expectedServiceSubscope);
        }
        if (!helper.isAgeAboveOrEqual(MINIMUM_AGE, params.committedInputs)) {
            revert AgePolicyMismatch(MINIMUM_AGE);
        }
        _verifyAdditionalPolicy(helperAddress, params.committedInputs);

        // Official layout: current date=2, scope=3, subscope=4, then parameter
        // commitments, nullifier type, scoped nullifier, and OPRF key hash.
        uint256 timestamp = helper.getProofTimestamp(publicInputs);
        if (timestamp > type(uint64).max) revert ProofTimestampOverflow(timestamp);
        if (timestamp != uint256(publicInputs[2])) revert InvalidPublicInputs();

        uint256 nullifierType = uint256(publicInputs[publicInputs.length - 3]);
        if (nullifierType > type(uint16).max) {
            revert NullifierTypeOverflow(nullifierType);
        }
        // @zkpassport/utils NullifierType is exactly 0..3. Values 2 and 3
        // are mock modes and are valid only for the explicit Alpha dev policy.
        if (nullifierType > 3) revert UnsupportedNullifierType(nullifierType);
        if (!devMode && nullifierType > 1) {
            revert MockNullifierTypeDisabled(nullifierType);
        }
        bytes32 publicInputNullifier = publicInputs[publicInputs.length - 2];
        if (uniqueIdentifier == bytes32(0) || uniqueIdentifier != publicInputNullifier) {
            revert NullifierMismatch(uniqueIdentifier, publicInputNullifier);
        }

        fields = VerifiedProofFields({
            scopedNullifier: uniqueIdentifier,
            nullifierType: uint16(nullifierType),
            serviceScopeHash: publicInputs[3],
            serviceSubscopeHash: publicInputs[4],
            proofTimestamp: uint64(timestamp)
        });
    }

    function _rootVerifierAddress() internal view virtual returns (address) {
        return ZKPASSPORT_ROOT_VERIFIER;
    }

    function _validateCommittedInputs(bytes memory inputs) internal pure virtual {
        if (inputs.length != 5 || keccak256(inputs) != keccak256(hex"0100021200")) {
            revert QueryPolicyMismatch();
        }
    }

    function _verifyAdditionalPolicy(address, bytes memory) internal view virtual {}
}
