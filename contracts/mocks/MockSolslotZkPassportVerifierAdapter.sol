// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ISolslotZkPassportVerifierAdapter} from "../SolslotZkPassportAttestationEmitter.sol";

contract MockSolslotZkPassportVerifierAdapter is ISolslotZkPassportVerifierAdapter {
    bool public accepted = true;
    bytes32 public requiredSubscopeHash;
    VerifiedProofFields private _fields;

    error MockProofRejected();
    error MockSubscopeMismatch();

    constructor() {
        _fields = VerifiedProofFields({
            scopedNullifier: bytes32(uint256(0x22)),
            nullifierType: 1,
            serviceScopeHash: bytes32(uint256(0x33)),
            serviceSubscopeHash: bytes32(uint256(0x44)),
            proofTimestamp: uint64(block.timestamp)
        });
    }

    function setAccepted(bool value) external {
        accepted = value;
    }

    function setRequiredSubscope(string calldata value) external {
        requiredSubscopeHash = keccak256(bytes(value));
    }

    function setFields(VerifiedProofFields calldata value) external {
        _fields = value;
    }

    function verifyVaultProof(bytes calldata, string calldata expectedServiceSubscope)
        external
        view
        returns (VerifiedProofFields memory)
    {
        if (!accepted) revert MockProofRejected();
        if (
            requiredSubscopeHash != bytes32(0)
                && requiredSubscopeHash != keccak256(bytes(expectedServiceSubscope))
        ) revert MockSubscopeMismatch();
        return _fields;
    }
}
