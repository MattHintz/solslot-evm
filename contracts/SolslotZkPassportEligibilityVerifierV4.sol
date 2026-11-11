// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {SolslotZkPassportEligibilityVerifierV1} from "./SolslotZkPassportEligibilityVerifierV1.sol";

/// @notice Adds only the explicitly reviewed 0.22.0 proof version. The V1
/// real-document, age, sanctions, scoped-nullifier and root-verifier gates
/// remain unchanged. Earlier adapters remain deployed independently.
contract SolslotZkPassportEligibilityVerifierV4 is SolslotZkPassportEligibilityVerifierV1 {
    bytes32 public constant PROOF_VERSION_0_21_0 =
        0x0000001500000000000000000000000000000000000000000000000000000000;
    bytes32 public constant PROOF_VERSION_0_21_1 =
        0x0000001500010000000000000000000000000000000000000000000000000000;
    bytes32 public constant PROOF_VERSION_0_22_0 =
        0x0000001600000000000000000000000000000000000000000000000000000000;

    function supportsProofVersion(bytes32 version) public pure override returns (bool) {
        return version == ACCEPTED_PROOF_VERSION || version == PROOF_VERSION_0_21_0
            || version == PROOF_VERSION_0_21_1 || version == PROOF_VERSION_0_22_0;
    }
}
