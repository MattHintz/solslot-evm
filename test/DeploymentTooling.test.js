import { expect } from 'chai';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    expect(deployment).to.include(
      "networkName === 'hardhat' ? null : await runtimeCodeHash(rootVerifierAddress)",
    );
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
          `HARDHAT_NETWORK=hardhat node --input-type=module -e "import fs from 'node:fs'; import { network } from 'hardhat'; const connection = await network.create(); process.stdout.write(connection.networkName + ':' + fs.readFileSync(3, 'utf8'))"`,
        ].join('\n'),
      ],
      { encoding: 'utf8' },
    );

    expect(result.status, result.stderr).to.equal(0);
    expect(result.stdout).to.match(/hardhat:descriptor-test-value$/);
  });
});
