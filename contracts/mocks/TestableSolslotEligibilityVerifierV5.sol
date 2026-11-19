// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {SolslotZkPassportEligibilityVerifierV5} from "../SolslotZkPassportEligibilityVerifierV5.sol";

contract TestableSolslotEligibilityVerifierV5 is SolslotZkPassportEligibilityVerifierV5 {
    address private immutable testRoot;

    constructor(address root) { testRoot = root; }

    function _rootVerifierAddress() internal view override returns (address) { return testRoot; }
}
