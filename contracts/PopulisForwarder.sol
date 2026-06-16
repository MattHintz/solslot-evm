// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title PopulisForwarder
 * @notice ERC-2771 trusted forwarder for gasless meta-transactions.
 *
 * Alpha testers sign an EIP-712 ForwardRequest in their wallet (no gas); the
 * operator's relayer calls {execute} and pays the gas. The forwarder verifies
 * the user's signature + nonce on-chain and forwards the call to the target
 * (PopulisZkPassportAttestationEmitter), appending the signer's address so the
 * target's `_msgSender()` resolves to the user — not the relayer.
 *
 * The EIP-712 domain name below is what the frontend must use when building the
 * typed data to sign:
 *   domain = { name: "PopulisForwarder", version: "1", chainId, verifyingContract }
 */
contract PopulisForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("PopulisForwarder") {}
}
