import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../../');

function parseNginxBytes(raw: string) {
  const match = /^(\d+)([kmg]?)$/i.exec(raw.trim());
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (unit === 'k') return amount * 1024;
  if (unit === 'm') return amount * 1024 * 1024;
  if (unit === 'g') return amount * 1024 * 1024 * 1024;
  return amount;
}

describe('container and nginx runtime configuration', () => {
  it('aligns nginx body size, proxy timeouts, cache control and security headers with client limits', () => {
    const conf = fs.readFileSync(path.join(repoRoot, 'deploy/nginx.conf'), 'utf8');

    const bodySizeMatch = /client_max_body_size\s+([^;\s]+)\s*;/.exec(conf);
    expect(bodySizeMatch).not.toBeNull();
    // Catalog imports allow 4 MiB JSON and bounded feedback payloads allow up to 16 MiB.
    expect(parseNginxBytes(bodySizeMatch?.[1] ?? '')).toBeGreaterThanOrEqual(
      16 * 1024 * 1024,
    );

    const readTimeout = /proxy_read_timeout\s+(\d+)s\s*;/.exec(conf);
    const sendTimeout = /proxy_send_timeout\s+(\d+)s\s*;/.exec(conf);
    // Http.blob sets 120s timeout; proxy timeouts must exceed client timeouts so valid slow responses do not become 504 uncertain writes.
    expect(Number(readTimeout?.[1] ?? 0)).toBeGreaterThan(120);
    expect(Number(sendTimeout?.[1] ?? 0)).toBeGreaterThan(120);
    expect(conf).toMatch(/proxy_set_header\s+X-Forwarded-Proto\s+\$scheme\s*;/);

    // Entry HTML and runtime app config must revalidate on upgrade, and retain clickjacking/MIME protections.
    for (const entry of ['/index.html', '/_app.config.js']) {
      const escaped = entry.replaceAll('.', String.raw`\.`);
      const block = new RegExp(
        String.raw`location\s*=\s*${escaped}\s*\{([^}]*)\}`,
      ).exec(conf)?.[1];
      expect(block, `missing location = ${entry}`).toBeTruthy();
      expect(block).toMatch(/Cache-Control\s+"no-cache"/);
      expect(block).toMatch(/X-Content-Type-Options\s+"nosniff"/);
      expect(block).toMatch(/frame-ancestors\s+'none'/);
      expect(block).toContain("connect-src 'self' https://media.stuhelper.com\"");
      expect(block).toMatch(/Referrer-Policy/);
    }

    const spaBlock = /location\s+\/\s*\{([^}]*)\}/.exec(conf)?.[1] ?? '';
    expect(spaBlock).toMatch(/X-Content-Type-Options\s+"nosniff"/);
    expect(spaBlock).toMatch(/frame-ancestors\s+'none'/);
    expect(spaBlock).toContain("connect-src 'self' https://media.stuhelper.com\"");
    expect(spaBlock).toMatch(/Referrer-Policy/);
  });

  it('passes APP_VERSION into the Vite build stage, keeps version tags and runs nginx unprivileged', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
    const stages = dockerfile.split(/^FROM\s+/m).slice(1);
    expect(stages.length).toBeGreaterThanOrEqual(2);

    for (const stage of stages) {
      const imageRef = stage.split(/\s+/)[0] ?? '';
      expect(imageRef).not.toContain('@sha256:');
      expect(imageRef).toContain(':');
    }

    const buildStage = stages[0] ?? '';
    const runtimeStage = stages[1] ?? '';
    expect(buildStage).toMatch(/^\s*ARG\s+APP_VERSION\b/m);
    expect(buildStage).toMatch(
      /^\s*ENV\s+VITE_APP_VERSION=\$\{APP_VERSION\}/m,
    );
    expect(runtimeStage).toMatch(/^\s*USER\s+nginx\s*$/m);

    const metadataPlugin = fs.readFileSync(
      path.join(repoRoot, 'internal/vite-config/src/plugins/inject-metadata.ts'),
      'utf8',
    );
    expect(metadataPlugin).toContain('process.env.VITE_APP_VERSION');
  });
});
