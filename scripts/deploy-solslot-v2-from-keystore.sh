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

for name in \
  SOLSLOT_ETH_SEPOLIA_RPC_URL \
  SOLSLOT_EVM_SOURCE_SHA \
  SOLSLOT_PROTOCOL_SOURCE_SHA \
  SOLSLOT_EVM_DEPLOYMENT_OUTPUT \
  SOLSLOT_ZKPASSPORT_BRIDGE_POLICY_HASH \
  SOLSLOT_ZKPASSPORT_BLS_RELAYER_ADDRESS \
  SOLSLOT_ZKPASSPORT_DOMAIN; do
  [[ -n "${!name:-}" ]] || {
    printf '%s is required\n' "$name" >&2
    exit 1
  }
done

read -r -s -p 'EVM operator keystore passphrase: ' passphrase
printf '\n' >&2
exec 3<<<"$passphrase"
unset passphrase
trap 'exec 3<&-' EXIT

export SOLSLOT_DEPLOYER_KEYSTORE_PATH="$keystore"
export SOLSLOT_KEYSTORE_PASSPHRASE_FD=3
export SOLSLOT_EVM_CONFIRMATIONS="${SOLSLOT_EVM_CONFIRMATIONS:-12}"

cd "$repo_dir"
./node_modules/.bin/hardhat run scripts/deploy-solslot-v2.js --network ethSepolia
