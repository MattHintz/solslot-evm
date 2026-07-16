'use strict';

const { expect } = require('chai');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

describe('Solslot V2 deployment tooling', () => {
  const root = path.resolve(__dirname, '..');

  it('loads the operator from an encrypted keystore file descriptor', () => {
    const deployment = fs.readFileSync(
      path.join(root, 'scripts', 'deploy-solslot-v2.js'),
      'utf8',
    );
    const config = fs.readFileSync(path.join(root, 'hardhat.config.js'), 'utf8');
    const wrapper = fs.readFileSync(
      path.join(root, 'scripts', 'deploy-solslot-v2-from-keystore.sh'),
      'utf8',
    );

    expect(deployment).to.include('Wallet.fromEncryptedJson');
    expect(deployment).to.include('SOLSLOT_KEYSTORE_PASSPHRASE_FD');
    expect(wrapper).to.include(
      'mktemp /dev/shm/solslot-keystore-passphrase.XXXXXX',
    );
    expect(wrapper).to.include('exec 3<"$passphrase_file"');
    expect(wrapper).to.include('rm -f -- "$passphrase_file"');
    expect(wrapper).not.to.include('<<<"$passphrase"');
    expect(wrapper).to.include(
      'HARDHAT_NETWORK=ethSepolia node scripts/deploy-solslot-v2.js',
    );
    expect(wrapper).not.to.include('hardhat run scripts/deploy-solslot-v2.js');
    expect(`${deployment}\n${config}`).not.to.include('SOLSLOT_DEPLOYER_PRIVATE_KEY');
  });

  it('keeps the passphrase descriptor readable after unlinking tmpfs storage', () => {
    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'set -euo pipefail',
          'umask 077',
          'phrase="descriptor-test-value"',
          'file="$(mktemp /dev/shm/solslot-keystore-passphrase.XXXXXX)"',
          'printf %s "$phrase" > "$file"',
          'exec 3<"$file"',
          'rm -f -- "$file"',
          'unset phrase',
          `HARDHAT_NETWORK=hardhat node -e "const fs=require('node:fs'); const {network}=require('hardhat'); process.stdout.write(network.name + ':' + fs.readFileSync(3, 'utf8'))"`,
        ].join('\n'),
      ],
      { encoding: 'utf8' },
    );

    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.match(/hardhat:descriptor-test-value$/);
  });
});
