# Age and sanctions verifier for the full Testnet11 release

Identity stays on Ethereum Sepolia (11155111); payments stay on Base (8453).
The new verifier fixes `solslot.com`, real proofs (`devMode=false`), age 18+,
all-country/all-list sanctions checking and the standard sanctions policy.
Historical age-only proofs remain historical; they do not acquire sanctions
status through an application update.

Compile the clean source, then prepare an offline plan:

```sh
node scripts/prepare-eligibility-deployment.js public-input.json new-plan.json
```

The input contains the nine exact source SHAs, production-alpha environment,
explicit ethSepolia network/chain, deployment ID, deployer and observed start
nonce, direct relayer, three BLS validator public keys, independently observed
root verifier runtime hash, per-contract gas bounds, and ActionEnvelope ID.
See `prepareEligibilityPlan` and `EligibilityDeployment.test.js` for the strict
input schema. No keys, private RPC URLs or secret values belong in this input.

The plan fixes CREATE addresses and constructor hashes for the forwarder,
`SolslotZkPassportEligibilityVerifierV1`, and attestation emitter. It preserves
the legacy Chia bridge wire format and includes the new identity policy in a
schema-2 evidence artifact. It is not the Base enrollment-permit deployment.

Execution uses the existing selected-deployment keystore wrapper and requires
explicit approval of the plan hash and fee ceiling. The runner persists all
signed transactions before sending, retains exact bytes across timeout/restart,
checks the selected chain/nonce/balance/root code, and confirms each creation
before continuing. The old unplanned eligibility deployment path is disabled
outside the local simulator.

Before execution, independently recheck the public inputs against two RPC
providers. After execution, independently attest receipts, runtime code and
policy getters before binding the artifact into a fresh genesis. Preserve
the signed transaction journal even when a deployment or subsequent service
activation fails. A rollback cannot erase a chain deployment or nonce.

Local tests cover a complete deployment, interrupted broadcast recovery,
compiled constructor/address binding, the independently derived Chia bridge
policy, real age/sanctions policy enforcement, and rejection of wrong chains,
domains, mock mode and permit-only fields. These are not live deployment
receipts or a replacement for release security review.
