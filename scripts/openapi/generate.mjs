import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(dir, '../../contracts');
const outputDir = path.resolve(dir, '../../apps/web-antd/src/api');

const contracts = fs
  .readdirSync(contractsDir)
  .filter((name) => /\.openapi\.(?:json|yaml)$/.test(name))
  .toSorted();

const requiredContracts = [
  'billing.openapi.json',
  'catalog.openapi.json',
  'contribution.openapi.json',
  'favorites.openapi.json',
  'groups.openapi.json',
  'information-query.openapi.json',
  'legal.openapi.json',
  'media.openapi.json',
  'moderation.openapi.json',
  'open-platform.openapi.json',
  'platform-admin.openapi.json',
  'platform-eligibility.openapi.json',
  'platform.openapi.yaml',
  'profiles.openapi.json',
  'qq-binding.openapi.json',
  'resources.openapi.json',
  'reviews.openapi.json',
  'session.openapi.json',
  'storage.openapi.json',
  'verification.openapi.yaml',
];
for (const file of requiredContracts) {
  assert.ok(contracts.includes(file), `Missing OpenAPI contract: ${file}`);
}

for (const file of contracts) {
  const name = file.replace(/\.openapi\.(?:json|yaml)$/, '');
  const input = path.join(contractsDir, file);
  const output = path.join(outputDir, `${name}.gen.ts`);
  execFileSync('pnpm', ['exec', 'openapi-typescript', input, '-o', output], {
    cwd: dir,
    stdio: 'inherit',
  });
}
