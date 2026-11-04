// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {SolslotZkPassportEligibilityVerifierV1} from "./SolslotZkPassportEligibilityVerifierV1.sol";

/// @notice Explicit 0.21.1 compatibility with the unchanged real-document,
/// age-18, vault-scope and current sanctions-registry policy.
/// @dev V1 and V2 retain their original version boundaries. No caller can
/// install another verifier, enable dev mode or admit a future proof version.
contract SolslotZkPassportEligibilityVerifierV3 is SolslotZkPassportEligibilityVerifierV1 {
    bytes32 public constant PROOF_VERSION_0_21_0 =
        0x0000001500000000000000000000000000000000000000000000000000000000;
    bytes32 public constant PROOF_VERSION_0_21_1 =
        0x0000001500010000000000000000000000000000000000000000000000000000;

    function supportsProofVersion(bytes32 version) public pure override returns (bool) {
        return version == ACCEPTED_PROOF_VERSION
            || version == PROOF_VERSION_0_21_0
            || version == PROOF_VERSION_0_21_1;
    }
}
