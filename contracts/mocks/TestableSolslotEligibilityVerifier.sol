// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;
import {SolslotZkPassportEligibilityVerifierV1} from "../SolslotZkPassportEligibilityVerifierV1.sol";
import {MockSolslotZkPassportVerifierHelper} from "./MockSolslotZkPassportRootVerifier.sol";

contract TestableSolslotEligibilityVerifier is SolslotZkPassportEligibilityVerifierV1 {
    address private immutable testRoot;
    constructor(address root) { testRoot = root; }
    function _rootVerifierAddress() internal view override returns (address) { return testRoot; }
}

contract MockSolslotEligibilityHelper is MockSolslotZkPassportVerifierHelper {
    bool private rootValid = true;
    function setSanctionsRootValid(bool value) external { rootValid = value; }
    function enforceSanctionsRoot(uint256 at, bool strict, bytes calldata) external view {
        require(at == block.timestamp, "must check current sanctions registry");
        require(!strict, "must match standard dashboard policy");
        require(rootValid, "invalid sanctions root");
    }
}
