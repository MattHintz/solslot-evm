// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {SolslotZkPassportEligibilityVerifierV3} from "../SolslotZkPassportEligibilityVerifierV3.sol";

contract TestableSolslotEligibilityVerifierV3 is SolslotZkPassportEligibilityVerifierV3 {
    address private immutable testRoot;
    constructor(address root) { testRoot = root; }
    function _rootVerifierAddress() internal view override returns (address) { return testRoot; }
}
