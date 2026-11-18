import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const openapiDir = path.join(root, 'scripts', 'openapi');

const contracts = [
  ['platform.openapi.yaml', 'platform.gen.ts'],
  ['storage.openapi.json', 'storage.gen.ts'],
  ['contribution.openapi.json', 'contribution.gen.ts'],
  ['session.openapi.json', 'session.gen.ts'],
  ['verification.openapi.yaml', 'verification.gen.ts'],
  ['catalog.openapi.json', 'catalog.gen.ts'],
  ['reviews.openapi.json', 'reviews.gen.ts'],
  ['moderation.openapi.json', 'moderation.gen.ts'],
  ['resources.openapi.json', 'resources.gen.ts'],
  ['media.openapi.json', 'media.gen.ts'],
  ['favorites.openapi.json', 'favorites.gen.ts'],
  ['profiles.openapi.json', 'profiles.gen.ts'],
  ['open-platform.openapi.json', 'open-platform.gen.ts'],
  ['billing.openapi.json', 'billing.gen.ts'],
  ['qq-binding.openapi.json', 'qq-binding.gen.ts'],
  ['platform-admin.openapi.json', 'platform-admin.gen.ts'],
  ['platform-eligibility.openapi.json', 'platform-eligibility.gen.ts'],
  ['information-query.openapi.json', 'information-query.gen.ts'],
  ['groups.openapi.json', 'groups.gen.ts'],
];

for (const [spec, out] of contracts) {
  execFileSync(
    'pnpm',
    [
      '--dir',
      openapiDir,
      'exec',
      'openapi-typescript',
      path.join(root, 'contracts', spec),
      '-o',
      path.join(root, 'apps/web-antd/src/api', out),
    ],
    { stdio: 'inherit' },
  );
}
