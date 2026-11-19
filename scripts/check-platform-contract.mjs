import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = JSON.parse(
  fs.readFileSync('contracts/platform.source.json', 'utf8'),
);
assert.equal(source.repository, 'StuHelper/stuhelper-platform');
assert.match(source.revision, /^[a-f0-9]{40}$/);
assert.deepEqual(source.files, {
  'contracts/platform.openapi.yaml': 'contracts/platform.openapi.yaml',
  'sdk/platform.gen.ts': 'apps/web-antd/src/api/platform.gen.ts',
  'contracts/client-cases.json': 'contracts/client-cases.json',
});

for (const localFile of Object.values(source.files)) {
  assert.ok(fs.existsSync(localFile), `Missing synced platform file: ${localFile}`);
}

const contract = fs.readFileSync('contracts/platform.openapi.yaml');
assert.equal(
  createHash('sha256').update(contract).digest('hex'),
  source.sha256,
);
const version = (
  contract.toString('utf8').match(/\n {2}version: ['"]?([^'"\n]+)/) ?? []
)[1];
assert.equal(version, source.version);

const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), 'stuhelper-admin-platform-contract-'),
);
try {
  const output = path.join(temporary, 'platform.gen.ts');
  execFileSync(
    'pnpm',
    [
      '--dir',
      'scripts/openapi',
      'exec',
      'openapi-typescript',
      '../../contracts/platform.openapi.yaml',
      '-o',
      output,
    ],
    { stdio: 'inherit' },
  );
  assert.equal(
    fs.readFileSync(output, 'utf8'),
    fs.readFileSync('apps/web-antd/src/api/platform.gen.ts', 'utf8'),
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(`PASS: platform contract ${source.revision}`);
