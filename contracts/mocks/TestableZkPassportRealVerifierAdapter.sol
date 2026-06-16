// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ZkPassportRealVerifierAdapter, ProofVerificationParams, IZKPassportRootVerifier, IZKPassportVerifierHelper} from "../ZkPassportRealVerifierAdapter.sol";
import {IZkPassportVerifierAdapter} from "../PopulisZkPassportAttestationEmitter.sol";

contract TestableZkPassportRealVerifierAdapter is ZkPassportRealVerifierAdapter {
    address private _testVerifier;

    constructor(string memory domain_, bool devMode_, address testVerifier_)
        ZkPassportRealVerifierAdapter(domain_, devMode_)
    {
        _testVerifier = testVerifier_;
    }

    function verifyVaultAttestation(
        bytes calldata proof,
        VaultAttestation calldata,
        bytes32,
        string calldata expectedServiceSubscope
    ) external view override returns (bool) {
        if (proof.length == 0) revert EmptyProof();

        ProofVerificationParams memory params = abi.decode(proof, (ProofVerificationParams));

        params.serviceConfig.domain = domain;
        params.serviceConfig.scope = expectedServiceSubscope;
        params.serviceConfig.devMode = devMode;
        params.serviceConfig.validityPeriodInSeconds = DEFAULT_VALIDITY_SECONDS;

        (bool valid, , address helperAddr) = IZKPassportRootVerifier(_testVerifier).verify(params);

        if (!valid) revert ProofVerificationFailed();
        if (helperAddr == address(0)) revert InvalidHelperAddress();

        bool scopesOk = IZKPassportVerifierHelper(helperAddr).verifyScopes(
            params.proofVerificationData.publicInputs,
            domain,
            expectedServiceSubscope
        );
        if (!scopesOk) revert ScopeMismatch(expectedServiceSubscope);

        return true;
    }
}
