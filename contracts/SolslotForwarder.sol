// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Solslot v2 trusted forwarder for gas-sponsored zkPassport proofs.
contract SolslotForwarder is ERC2771Forwarder {
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("SolslotForwarder");
    bytes32 private constant VERSION_HASH = keccak256("2");

    constructor() ERC2771Forwarder("SolslotForwarder") {}

    /// @dev ERC2771Forwarder currently fixes its domain version to "1".
    /// The V2 deployment deliberately replaces that separator so signatures
    /// from any retired forwarder domain cannot be replayed here.
    function _v2DomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function _hashTypedDataV4(bytes32 structHash) internal view override returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(_v2DomainSeparator(), structHash);
    }

    function eip712Domain()
        public
        view
        override
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (
            hex"0f",
            "SolslotForwarder",
            "2",
            block.chainid,
            address(this),
            bytes32(0),
            new uint256[](0)
        );
    }
}
