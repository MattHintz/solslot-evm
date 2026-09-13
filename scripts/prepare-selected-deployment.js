/** Offline plan generation. No provider calls, key access or approval creation. */
import fs from 'node:fs';
import { network } from 'hardhat';
import { prepareSelectedPlan, readCanonical, stableJson } from './selected-deployment.js';
const [inputPath,outputPath]=process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('Usage: node scripts/prepare-selected-deployment.js INPUT OUTPUT');
const { ethers }=await network.create('selectedLocal');
const plan=await prepareSelectedPlan(readCanonical(inputPath),name=>ethers.getContractFactory(name));
fs.writeFileSync(outputPath,stableJson(plan)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:'draft_requires_review',planHash:plan.planHash,output:outputPath}));
