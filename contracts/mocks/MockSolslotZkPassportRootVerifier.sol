// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {
    SolslotProofVerificationParams,
    SolslotZkPassportVerifierAdapter
} from "../SolslotZkPassportVerifierAdapter.sol";

contract MockSolslotZkPassportRootVerifier {
    bool public valid = true;
    bytes32 public uniqueIdentifier;
    address public helper;

    function configure(bool valid_, bytes32 uniqueIdentifier_, address helper_) external {
        valid = valid_;
        uniqueIdentifier = uniqueIdentifier_;
        helper = helper_;
    }

    function verify(SolslotProofVerificationParams calldata)
        external
        view
        returns (bool, bytes32, address)
    {
        return (valid, uniqueIdentifier, helper);
    }
}

contract MockSolslotZkPassportVerifierHelper {
    bool public scopesValid = true;
    bool public ageValid = true;
    uint256 public timestamp;

    function configure(bool scopesValid_, bool ageValid_, uint256 timestamp_) external {
        scopesValid = scopesValid_;
        ageValid = ageValid_;
        timestamp = timestamp_;
    }

    function verifyScopes(bytes32[] calldata, string calldata, string calldata)
        external
        view
        returns (bool)
    {
        return scopesValid;
    }

    function getProofTimestamp(bytes32[] calldata) external view returns (uint256) {
        return timestamp;
    }

    function isAgeAboveOrEqual(uint8, bytes calldata) external view returns (bool) {
        return ageValid;
    }
}

contract TestableSolslotZkPassportVerifierAdapter is SolslotZkPassportVerifierAdapter {
    address private immutable _testRootVerifier;

    constructor(string memory domain_, bool devMode_, address rootVerifier_)
        SolslotZkPassportVerifierAdapter(domain_, devMode_)
    {
        _testRootVerifier = rootVerifier_;
    }

    function _rootVerifierAddress() internal view override returns (address) {
        return _testRootVerifier;
    }
}
