# Base identity with Chia Testnet11 alpha

The selected identity deployment accepts the explicit pair `network: "base"`, `chainId: 8453`. This places the Solslot identity forwarder, verifier adapter and enrollment-permit emitter on Base mainnet, next to the official ZKPassport root verifier. It does not change Chia `testnet11` or the operational Base Sepolia network in the ceremony artifact.

The historical pair `baseSepolia` / `84532` remains valid. For compatibility, an old planning input that omits both fields still constructs that historical pair. New Base inputs must provide both fields. Changing only the chain, network or existing context is rejected. Existing sealed plans are never rewritten or silently migrated; their init-code hashes must still match their original reviewed build.

The identity EVM chain is part of the Chia enrollment context. Its CLVM positive integer atom is `0x2105` for 8453, versus historical `0x014a34` for 84532. The shared Base fixture proves that the EVM planning code and Python/CLVM implementation derive the same context and bridge policy. Enrollment EIP-712 signatures and event receipt checks use the identity chain. Operational payments and ceremony configuration retain their separately selected chain.

## ZKPassport compatibility

Official [onchain documentation](https://docs.zkpassport.id/getting-started/onchain) lists Base mainnet at root `0x1D000001000EFD9a6371f4d90bB8920D5431c0D8`; Base Sepolia is not listed. The [official Base deployment record](https://github.com/zkpassport/circuits/blob/9acc1e0400ddb3f226c83ed8c73f4a041af3ccb2/src/solidity/deployments/addresses-8453.json) registers proof version 0.20.0 with subverifier `0x8c424C342211DAde4Bf40B0f4c5a09D9a8810694` and helper `0x1887a01437Ddbee7Dc7cFdA666eEfAd441d671BD`.

The adapter accepts proof version 0.20.0 explicitly. Its public-input tail is nullifier type, scoped nullifier, then OPRF key hash. Older deployed subverifiers have a different tail. This version guard prevents interpreting an arbitrary client-selected layout without a compatibility update. It does not pin upstream administrative state or make the verifier immutable.

The constructor and selected-plan schema remain unchanged. The adapter replaces client-supplied service domain, vault scope, validity period and dev mode with the Solslot policy, requires an exact 18+ query, rejects mock modes outside dev policy, and requires the root-returned nonzero identifier to match the proven scoped nullifier. The selected deployment always uses `devMode: false`. The emitter separately rejects stale/future proof timestamps, wrong-chain permit signatures, wrong context and replayed permits/bridge coins.

The live helper supports the three helper methods used by Solslot. Do not assume newer upstream methods `getNullifierType` or `enforceNullifierType` exist at this deployed helper address. The proof version is distinct from the JavaScript SDK package version.

The adapter accepts only the exact age-only committed-input bytes `0x0100021200`: AGE, payload length 2, minimum 18, no upper bound. Additional disclosure, bind, country, sanctions, face-match or duplicate records are rejected before external verification. The API must apply the same check before persisting or relaying proof data. This ensures successful Solslot enrollment proofs carry no passport detail disclosures; it cannot prevent unrelated callers from submitting arbitrary data to a public chain, and scoped identity metadata is still retained for verification/replay protection.

## Upstream trust and release checks

The root is not an EIP-1967 proxy, but its admin may change the subverifier/helper mapping for a version. The subverifier admin may change proof-verifier mappings and the OPRF key; registry administrators manage certificate/circuit roots. Recording only the root runtime hash does not freeze those dependencies. Before activating an identity deployment, record a block-consistent observation of the selected version mapping, helper/library code, subverifier/proof-verifier code, registry addresses and pause state. Recheck changes as a readiness dependency; do not present the observation as a replacement for upstream trust.

At the 2026-09-18 observation, the root and subverifier were unpaused and the official addresses matched Base state. Read-only helper checks verified age-query behavior, scope/domain rejection and timestamp extraction. These checks are not a real passport proof or mobile-wallet acceptance test.

## Operator execution

Public preparation and preview use no key. `SOLSLOT_BASE_MAINNET_RPC_URL` selects the Base deployment RPC; `SOLSLOT_BASE_SEPOLIA_RPC_URL` remains the historical selection. The wrapper derives the network from a validated, checksum-pinned plan and runs public preflight before requesting the keystore passphrase. The runner checks both the Hardhat network name and RPC chain against the selected plan before signer access.

An exact final Base plan needs the actual configured permit issuer, release identity, validator set, constructor arguments and fixed fees. Indicative gas estimates with placeholder constructor values are not such a plan. Deployment and enrollment events on Base require real Base ETH. This implementation work does not itself sign, broadcast, enable enrollment or change launch locks.
