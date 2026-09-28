# Explicit 0.21.0 proof compatibility

`SolslotZkPassportEligibilityVerifierV2` accepts proof versions 0.20.0 and
0.21.0. The legacy age-only adapter and eligibility V1 still accept only
0.20.0. Versions registered later by ZKPassport are not implicitly accepted.

The reviewed upstream source is zkpassport/zkpassport-packages commit
`9589fa677f194f346a5b49d524bc6edd245e1c34`. Both layouts use public-input
positions 2/3/4 for timestamp/domain/scope and the final three fields for
nullifier type/nullifier/OPRF key hash. The 0.21.0 Sepolia helper was also
read with synthetic inputs to check those positions. Those observations and
mock-root tests do not constitute a successful real-passport proof test.

V2 inherits the exact V1 age and sanctions parser and current sanctions-root
check. It retains the canonical root verifier, vault scope, `solslot.com`,
real-document mode, age 18, standard sanctions matching, seven-day validity,
nonzero nullifier, and rejection of mock/unsupported nullifier modes.

Prepare a separate fixed deployment with a clean committed checkout:

```sh
node scripts/prepare-eligibility-deployment.js INPUT.json OUTPUT.json --compatibility-v2
```

This produces deployment-plan schema v2 and binds the explicit version list
and V2 init code. Omitting the option retains the existing V1 plan format.
The existing journaled runner can preview the plan without a key, and only
executes after exact-plan approval. Legacy plan validation remains supported.

Deployment does **not** activate the contracts. The current attestation
emitter has an immutable verifier address, and the signed genesis archive
pins all three EVM addresses. Coordinator, validators, and customer review
must independently validate a separately authorized deployment amendment
before using new contracts. There is no implemented amendment path in this
patch. Do not rewrite the genesis archive, replace its address fields,
relax runtime binding, or relabel a generated proof as an older version.

Existing vault/bridge puzzles bind the validator roster and threshold,
rather than the EVM contract addresses. That permits investigation of a
vault-preserving amendment; it does not itself authorize a migration.
Activation remains blocked pending that implementation, review, deployment
receipt checks, and owner-plus-coadministrator authorization.
