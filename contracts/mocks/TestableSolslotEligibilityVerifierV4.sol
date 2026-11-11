// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;
import {SolslotZkPassportEligibilityVerifierV4} from "../SolslotZkPassportEligibilityVerifierV4.sol";
contract TestableSolslotEligibilityVerifierV4 is SolslotZkPassportEligibilityVerifierV4 {
    address private immutable testRoot;
    constructor(address root) { testRoot = root; }
    function _rootVerifierAddress() internal view override returns (address) { return testRoot; }
}
