// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {SolslotZkPassportEligibilityVerifierV4} from "./SolslotZkPassportEligibilityVerifierV4.sol";

/// @notice Extends the existing eligibility policy to ICAO chip proofs from circuit 0.23.0.
contract SolslotZkPassportEligibilityVerifierV5 is SolslotZkPassportEligibilityVerifierV4 {
    bytes32 public constant PROOF_VERSION_0_23_0 =
        0x0000001700000000000000000000000000000000000000000000000000000000;
    uint256 private constant ICAO_CHIP = 100;

    error UnsupportedVerificationMethod(uint256 method);

    function supportsProofVersion(bytes32 version) public pure override returns (bool) {
        return version == PROOF_VERSION_0_23_0 || super.supportsProofVersion(version);
    }

    function _nullifierTypeOffset(bytes32 version, bytes32[] memory publicInputs)
        internal pure override returns (uint256)
    {
        if (version != PROOF_VERSION_0_23_0) return super._nullifierTypeOffset(version, publicInputs);

        // 0.23.0 has five fixed fields, exactly two policy commitments and
        // four trailing fields. The upstream root verifies all public inputs.
        if (publicInputs.length != 11) revert InvalidPublicInputs();
        uint256 method = uint256(publicInputs[10]);
        if (method != ICAO_CHIP) revert UnsupportedVerificationMethod(method);
        return 4;
    }
}
