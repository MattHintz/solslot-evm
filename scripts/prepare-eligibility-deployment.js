/** Offline, write-once deployment plan. No wallet, RPC or broadcast. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { artifacts } from 'hardhat';
import { ethers } from 'ethers';
import { prepareEligibilityPlan, stableJson } from './selected-deployment.js';

const [inputPath, outputPath, ...extra] = process.argv.slice(2);
if (!inputPath || !outputPath || extra.length) throw new Error('Usage: node scripts/prepare-eligibility-deployment.js INPUT.json OUTPUT.json');
const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();
if (git('status','--porcelain')) throw new Error('Commit the reviewed EVM source before preparing a deployment plan');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (input.sourceShas?.evm !== git('rev-parse','HEAD')) throw new Error('EVM source SHA differs from the reviewed checkout');
const plan = await prepareEligibilityPlan(input, async name => {
  const artifact = await artifacts.readArtifact(name);
  return new ethers.ContractFactory(artifact.abi, artifact.bytecode);
});
const target = path.resolve(outputPath);
const fd = fs.openSync(target, fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW, 0o600);
const bytes = stableJson(plan) + '\n';
try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
const directory = fs.openSync(path.dirname(target), fs.constants.O_RDONLY);
try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
console.log(JSON.stringify({status:'prepared_not_deployed',output:target,planHash:plan.planHash,
  fileSha256:ethers.sha256(ethers.toUtf8Bytes(bytes)).slice(2),actionEnvelopeId:plan.actionEnvelopeId}, null, 2));
