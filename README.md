# Solslot EVM

Fresh Solslot V2 contracts for the zkPassport-to-Chia credential bridge.

## Active Contracts

- `SolslotForwarder`: gas-sponsored ERC-2771 forwarding.
- `SolslotZkPassportVerifierAdapter`: pins the zkPassport verifier, domain,
  vault subscope, proof timestamp, 18+ alpha policy, and proof-derived
  nullifier fields.
- `SolslotZkPassportAttestationEmitter`: derives Chia commitments from verified
  public inputs and consumes each vault-scoped nullifier and bridge coin once.

The active tree contains no retired deployable contracts. Historical contracts,
deployment outputs, and exploit evidence live only in the external V1 evidence
archive.

## Trust Boundary

The proof supplies no caller-selected attestation fields. The adapter overrides
the proof's service configuration with its immutable domain and the exact
`vault:0x<launcher-id>` subscope. The emitter computes the attestation leaf,
bridge coin ID, Chia bridge message, and validator message on-chain.

An EVM event is evidence for the Chia bridge, not final vault verification. The
API must still authenticate the vault owner, index the exact event, allocate the
bridge coin, enforce one-time relay budgets, and confirm the stamped current
Chia vault coin.

The verifier ABI and public-input layout are pinned to the official
`zkpassport/zkpassport-packages` commit
`caa9cc08916babb5ac28ba5903a7518dd7a75775`. Updating that dependency requires
an explicit adapter review and a fresh deployment.

## Commands

Hardhat 3 requires Node.js 22.10 or newer. The project uses only the explicit
Ethers, Mocha, matcher, and network-helper plugins needed by this repository.

```bash
npm ci
npm audit --audit-level=high
npm run check:namespace
npm run check:secrets
npm run compile
npm test
```

Deploy only after the protocol commit and bridge policy are frozen:

```bash
npm run deploy:solslot-v2:keystore
```

The deploy command decrypts the owner-only operator keystore from
`SOLSLOT_DEPLOYER_KEYSTORE_PATH` after an interactive passphrase prompt. The
passphrase is passed on a dedicated file descriptor, never in an environment
variable or command argument. It also requires the frozen protocol/EVM SHAs, dedicated BLS
relayer address, at least 12 confirmations, and a new evidence output path. It
refuses to overwrite an existing artifact. The output binds all three
deployment receipts and runtime bytecode hashes, including the pinned
zkPassport root verifier, into one SHA256 artifact.

All runtime configuration uses `SOLSLOT_*` names. Mainnet deployment remains
disabled by the launch process until the production ceremony is approved.
