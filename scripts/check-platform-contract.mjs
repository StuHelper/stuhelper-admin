import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = JSON.parse(fs.readFileSync('contracts/platform.source.json', 'utf8'));
assert.equal(source.repository, 'StuHelper/stuhelper-platform');
assert.match(source.revision, /^[a-f0-9]{40}$/);

for (const localFile of Object.values(source.files ?? {})) {
  assert.equal(typeof localFile, 'string');
  assert.ok(fs.existsSync(localFile), `Missing synced platform file: ${localFile}`);
}

const contractBytes = fs.readFileSync('contracts/platform.openapi.yaml');
assert.equal(createHash('sha256').update(contractBytes).digest('hex'), source.sha256);

const versionMatch = /^\s*version:\s*["']?([^"'\s]+)["']?\s*$/m.exec(contractBytes.toString('utf8'));
assert.equal(versionMatch?.[1], source.version);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'stuhelper-admin-platform-contract-'));
try {
  const output = path.join(temporary, 'platform.gen.ts');
  execFileSync(
    'pnpm',
    ['--dir', 'scripts/openapi', 'exec', 'openapi-typescript', '../../contracts/platform.openapi.yaml', '-o', output],
    { stdio: 'inherit' },
  );
  assert.equal(fs.readFileSync(output, 'utf8'), fs.readFileSync('apps/web-antd/src/api/platform.gen.ts', 'utf8'));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(`PASS: platform contract ${source.revision}`);
