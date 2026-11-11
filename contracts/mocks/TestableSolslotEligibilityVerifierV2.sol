// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {SolslotZkPassportEligibilityVerifierV2} from "../SolslotZkPassportEligibilityVerifierV2.sol";

contract TestableSolslotEligibilityVerifierV2 is SolslotZkPassportEligibilityVerifierV2 {
    address private immutable testRoot;
    constructor(address root) { testRoot = root; }
    function _rootVerifierAddress() internal view override returns (address) { return testRoot; }
}
