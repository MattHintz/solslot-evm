#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
keystore="${SOLSLOT_DEPLOYER_KEYSTORE_PATH:-${HOME}/secure/solslot-secrets/evm-operator.keystore.json}"

[[ -f "$keystore" && ! -L "$keystore" ]] || {
  printf 'Encrypted EVM operator keystore is missing: %s\n' "$keystore" >&2
  exit 1
}
permissions="$(stat -c '%a' "$keystore")"
[[ "$permissions" == "600" || "$permissions" == "400" ]] || {
  printf 'Keystore permissions must be 600 or 400, found %s\n' "$permissions" >&2
  exit 1
}

deployment_network=ethSepolia
if [[ ${SOLSLOT_EVM_DEPLOYMENT_PLAN+x} ]]; then
  deployment_network=baseSepolia
  required_names=(SOLSLOT_BASE_SEPOLIA_RPC_URL SOLSLOT_EVM_DEPLOYMENT_PLAN SOLSLOT_EVM_PLAN_SHA256 SOLSLOT_ACTION_ENVELOPE_ID SOLSLOT_EVM_DEPLOYMENT_JOURNAL)
  [[ "${SOLSLOT_EVM_DEPLOYMENT_EXECUTE:-}" == approved ]] || { printf 'Explicit approved execution is required after plan review. Use the Node runner for public preview.\n' >&2; exit 1; }
else
  required_names=(SOLSLOT_ETH_SEPOLIA_RPC_URL SOLSLOT_EVM_SOURCE_SHA SOLSLOT_PROTOCOL_SOURCE_SHA SOLSLOT_EVM_DEPLOYMENT_OUTPUT SOLSLOT_ZKPASSPORT_BRIDGE_POLICY_HASH SOLSLOT_ZKPASSPORT_BLS_RELAYER_ADDRESS SOLSLOT_ZKPASSPORT_DOMAIN)
fi
for name in "${required_names[@]}"; do
  [[ -n "${!name:-}" ]] || { printf '%s is required\n' "$name" >&2; exit 1; }
done
# Public selected preflight runs before requesting the keystore passphrase.
if [[ "$deployment_network" == baseSepolia ]]; then
  (cd "$repo_dir" && SOLSLOT_EVM_DEPLOYMENT_EXECUTE=preview HARDHAT_NETWORK=baseSepolia node scripts/deploy-solslot-v2.js)
fi

read -r -s -p 'EVM operator keystore passphrase: ' passphrase
printf '\n' >&2

# Hardhat can mark inherited pipe descriptors nonblocking, which makes a
# here-string race with Node's synchronous descriptor read. Keep the phrase in
# an owner-only tmpfs inode, open it, and unlink it before Hardhat starts. The
# descriptor remains readable but no plaintext path survives the handoff.
passphrase_file="$(mktemp /dev/shm/solslot-keystore-passphrase.XXXXXX)"
cleanup_passphrase() {
  exec 3<&- 2>/dev/null || true
  if [[ -n "${passphrase_file:-}" ]]; then
    rm -f -- "$passphrase_file"
  fi
  unset passphrase
}
trap cleanup_passphrase EXIT HUP INT TERM
printf '%s' "$passphrase" > "$passphrase_file"
exec 3<"$passphrase_file"
rm -f -- "$passphrase_file"
passphrase_file=""
unset passphrase

export SOLSLOT_DEPLOYER_KEYSTORE_PATH="$keystore"
export SOLSLOT_KEYSTORE_PASSPHRASE_FD=3
export SOLSLOT_EVM_CONFIRMATIONS="${SOLSLOT_EVM_CONFIRMATIONS:-12}"

cd "$repo_dir"
HARDHAT_NETWORK="$deployment_network" node scripts/deploy-solslot-v2.js
