'use strict';

const { expect } = require('chai');
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
    expect(wrapper).to.include('exec 3<<<"$passphrase"');
    expect(`${deployment}\n${config}`).not.to.include('SOLSLOT_DEPLOYER_PRIVATE_KEY');
  });
});
