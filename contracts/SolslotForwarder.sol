// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @notice Solslot v2 trusted forwarder for gas-sponsored zkPassport proofs.
contract SolslotForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("SolslotForwarder") {}
}
