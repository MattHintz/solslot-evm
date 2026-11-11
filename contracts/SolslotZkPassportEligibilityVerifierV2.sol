// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {SolslotZkPassportEligibilityVerifierV1} from "./SolslotZkPassportEligibilityVerifierV1.sol";

/// @notice The same real-document age-18 and sanctions policy with explicit
/// 0.21.0 circuit support. Deploy separately; V1 and age-only keep their pins.
contract SolslotZkPassportEligibilityVerifierV2 is SolslotZkPassportEligibilityVerifierV1 {
    bytes32 public constant PROOF_VERSION_0_21_0 =
        0x0000001500000000000000000000000000000000000000000000000000000000;

    // 0.20.0 and 0.21.0 share timestamp/scope/subscope at 2/3/4 and the
    // three-field nullifier tail. Upstream source examined at
    // zkpassport-packages 9589fa677f194f346a5b49d524bc6edd245e1c34.
    // Root verification, canonical query policy, current sanctions root,
    // and real, nonzero vault-scoped nullifiers remain mandatory.
    function supportsProofVersion(bytes32 version) public pure override returns (bool) {
        return version == ACCEPTED_PROOF_VERSION || version == PROOF_VERSION_0_21_0;
    }
}
