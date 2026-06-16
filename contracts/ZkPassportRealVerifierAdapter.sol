// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {IZkPassportVerifierAdapter} from "./PopulisZkPassportAttestationEmitter.sol";

// ---------------------------------------------------------------------------
// Minimal interfaces for the deployed ZKPassport root verifier
// Source: https://github.com/zkpassport/zkpassport-packages (packages/zkpassport-sdk/src/assets/abi/ZKPassportVerifier.json)
// Verifier address (deterministic, all chains): 0x1D000001000EFD9a6371f4d90bB8920D5431c0D8
// ---------------------------------------------------------------------------

struct ProofVerificationData {
    bytes32 vkeyHash;
    bytes proof;
    bytes32[] publicInputs;
}

struct ServiceConfig {
    uint256 validityPeriodInSeconds;
    string domain;
    string scope;
    bool devMode;
}

struct ProofVerificationParams {
    bytes32 version;
    ProofVerificationData proofVerificationData;
    bytes committedInputs;
    ServiceConfig serviceConfig;
}

interface IZKPassportRootVerifier {
    function verify(ProofVerificationParams calldata params)
        external
        view
        returns (bool valid, bytes32 uniqueIdentifier, address helper);
}

interface IZKPassportVerifierHelper {
    function verifyScopes(
        bytes32[] calldata publicInputs,
        string calldata domain,
        string calldata scope
    ) external pure returns (bool);

    function getProofTimestamp(bytes32[] calldata publicInputs)
        external
        pure
        returns (uint256);

    function getScopedNullifier(bytes32[] calldata publicInputs)
        external
        pure
        returns (bytes32);
}

// ---------------------------------------------------------------------------
// ZkPassportRealVerifierAdapter
//
// Bridges the IZkPassportVerifierAdapter interface (used by
// PopulisZkPassportAttestationEmitter) to the real zkPassport root verifier
// deployed at ZKPASSPORT_VERIFIER_ADDR.
//
// The caller passes the raw ProofVerificationParams ABI-encoded as `proof`.
// The adapter decodes it, fills in ServiceConfig (domain + vault subscope),
// calls the root verifier, then cross-checks the returned helper to ensure
// the on-chain proof's scope matches the expected vault subscope.
//
// devMode: set true for alpha testnet (accepts Zero Knowledge Republic mock
// passports). Set false for mainnet.
// ---------------------------------------------------------------------------
contract ZkPassportRealVerifierAdapter is IZkPassportVerifierAdapter {
    address public constant ZKPASSPORT_ROOT_VERIFIER =
        0x1D000001000EFD9a6371f4d90bB8920D5431c0D8;

    uint256 public constant DEFAULT_VALIDITY_SECONDS = 7 days;

    string public domain;
    bool public immutable devMode;

    error ProofVerificationFailed();
    error ScopeMismatch(string expected);
    error EmptyProof();
    error InvalidHelperAddress();

    constructor(string memory domain_, bool devMode_) {
        require(bytes(domain_).length > 0, "ZkPassportRealVerifierAdapter: empty domain");
        domain = domain_;
        devMode = devMode_;
    }

    // -----------------------------------------------------------------------
    // IZkPassportVerifierAdapter implementation
    //
    // `proof` must be abi.encode(ProofVerificationParams) produced by the
    // zkPassport TypeScript SDK's getSolidityVerifierParameters().
    // The adapter ignores the SDK-supplied serviceConfig.domain/scope and
    // replaces them with the authoritative values (this.domain and
    // expectedServiceSubscope) so the caller cannot forge the scope binding.
    // -----------------------------------------------------------------------
    function verifyVaultAttestation(
        bytes calldata proof,
        VaultAttestation calldata, /* attestation — validated by emitter, not needed here */
        bytes32, /* bridgePolicyHash — verified by the emitter, not here */
        string calldata expectedServiceSubscope
    ) external view virtual override returns (bool) {
        if (proof.length == 0) revert EmptyProof();

        ProofVerificationParams memory params = abi.decode(proof, (ProofVerificationParams));

        // Override scope fields with authoritative values — prevents a caller
        // from supplying a proof scoped to a different vault.
        params.serviceConfig.domain = domain;
        params.serviceConfig.scope = expectedServiceSubscope;
        params.serviceConfig.devMode = devMode;
        params.serviceConfig.validityPeriodInSeconds = DEFAULT_VALIDITY_SECONDS;

        IZKPassportRootVerifier rootVerifier = IZKPassportRootVerifier(ZKPASSPORT_ROOT_VERIFIER);
        (bool valid, , address helperAddr) = rootVerifier.verify(params);

        if (!valid) revert ProofVerificationFailed();
        if (helperAddr == address(0)) revert InvalidHelperAddress();

        IZKPassportVerifierHelper helper = IZKPassportVerifierHelper(helperAddr);

        // Verify the proof is bound to our domain + the specific vault subscope.
        bool scopesOk = helper.verifyScopes(
            params.proofVerificationData.publicInputs,
            domain,
            expectedServiceSubscope
        );
        if (!scopesOk) revert ScopeMismatch(expectedServiceSubscope);

        return true;
    }
}
