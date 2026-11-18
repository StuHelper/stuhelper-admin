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

assert.ok(contracts.length >= 19, `Expected at least 19 OpenAPI contracts, found ${contracts.length}`);

for (const file of contracts) {
  const name = file.replace(/\.openapi\.(?:json|yaml)$/, '');
  const input = path.join(contractsDir, file);
  const output = path.join(outputDir, `${name}.gen.ts`);
  execFileSync('pnpm', ['exec', 'openapi-typescript', input, '-o', output], {
    cwd: dir,
    stdio: 'inherit',
  });
}
