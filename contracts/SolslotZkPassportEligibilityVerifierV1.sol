// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {SolslotZkPassportVerifierAdapter} from "./SolslotZkPassportVerifierAdapter.sol";

interface ISolslotSanctionsVerifierHelper {
    function enforceSanctionsRoot(uint256 timestamp, bool isStrict, bytes calldata committedInputs)
        external view;
}

/// @notice Normal-passport age and sanctions policy for solslot.com.
/// @dev Deployed separately from the legacy age-only adapter. Vault-scoped
/// proofs and owner authorizations remain required by the emitter/permit flow.
contract SolslotZkPassportEligibilityVerifierV1 is SolslotZkPassportVerifierAdapter {
    bytes32 public constant ELIGIBILITY_POLICY_ID = keccak256("solslot:age18:sanctions:all:standard:real:solslot.com:v1");
    // Matches the requested dashboard policy: all countries, all lists,
    // standard matching (name + date of birth, or passport + nationality).
    bool public constant SANCTIONS_STRICT = false;

    constructor() SolslotZkPassportVerifierAdapter("solslot.com", false) {}

    function _validateCommittedInputs(bytes memory inputs) internal pure override {
        // Official 0.20 EVM records: AGE=1, payload=2; SANCTIONS=9,
        // payload=33 (32-byte registry root + one canonical mode byte).
        // Accept either order; reject missing/duplicate checks, disclosures,
        // wallet binds, trailing data and malformed lengths before verification.
        if (inputs.length != 41) revert QueryPolicyMismatch();
        bool ageSeen;
        bool sanctionsSeen;
        uint256 offset;
        while (offset < inputs.length) {
            if (inputs.length - offset < 3) revert QueryPolicyMismatch();
            uint8 kind = uint8(inputs[offset]);
            uint256 length = (uint256(uint8(inputs[offset + 1])) << 8) | uint8(inputs[offset + 2]);
            offset += 3;
            if (length > inputs.length - offset) revert QueryPolicyMismatch();
            if (kind == 1 && length == 2 && !ageSeen) {
                if (uint8(inputs[offset]) != 18 || inputs[offset + 1] != 0) revert QueryPolicyMismatch();
                ageSeen = true;
            } else if (kind == 9 && length == 33 && !sanctionsSeen) {
                if (inputs[offset + 32] != 0) revert QueryPolicyMismatch();
                sanctionsSeen = true;
            } else {
                revert QueryPolicyMismatch();
            }
            offset += length;
        }
        if (!ageSeen || !sanctionsSeen) revert QueryPolicyMismatch();
    }

    function _verifyAdditionalPolicy(address helper, bytes memory inputs) internal view override {
        // Use inclusion time, so an old proof cannot reuse a sanctions root
        // that the official registry has since expired or revoked.
        ISolslotSanctionsVerifierHelper(helper).enforceSanctionsRoot(block.timestamp, SANCTIONS_STRICT, inputs);
    }
}
