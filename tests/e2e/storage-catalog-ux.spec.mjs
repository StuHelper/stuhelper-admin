import { Buffer } from 'node:buffer';
import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) =>
  JSON.parse(
    fs.readFileSync(
      `apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`,
      'utf8',
    ),
  );
const base = 'http://127.0.0.1:18786';
const storageExample = JSON.parse(
  fs.readFileSync('contracts/storage-operations.example.json', 'utf8'),
);

async function fits(page, info) {
  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('storage quota accepts binary GB and TB units and submits exact byte counts', async ({
  page,
}, info) => {
  const all = catalogue(info);
  const m = all.storage;
  const writes = [];
  const gbInstance = {
    ...storageExample.instances[0],
    id: 'gb-instance',
    adapter: 'bhpan', account_hint: '1***9', trusted: false,
    limit_bytes: 500 * 2 ** 30,
    used_bytes: 100 * 2 ** 30,
    reserved_bytes: 50 * 2 ** 30,
    available_bytes: 350 * 2 ** 30,
  };
  await page.route('**/api/v1/storage/operations**', async (route) => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON();
      writes.push(command);
      gbInstance.limit_bytes = command.limit_bytes;
      gbInstance.revision++;
      gbInstance.available_bytes = gbInstance.limit_bytes - gbInstance.used_bytes - gbInstance.reserved_bytes;
      return route.fulfill({ json: gbInstance });
    }
    return route.fulfill({
      json: { ...storageExample, instances: [gbInstance], intake: [{scope:"school",class:"restricted",mode:"paused",contribution_accounts:0,max_file_bytes:0,reason:"storage_restricted_encryption_unavailable"}] },
    });
  });

  await page.goto(`${base}/storage?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('heading', { name: 'BHpan · 1***9' })).toBeVisible();
  await expect(page.getByText(m.trust.storage_restricted_encryption_unavailable, { exact: true })).toBeVisible();
  const quota = page.getByLabel(m.quotaInput);
  await expect(quota).toHaveAttribute('placeholder', '500');
  // 120 GB is below used (100 GB) + reserved (50 GB) = 150 GB.
  await quota.fill('120');
  await expect(
    page.getByRole('button', { name: m.actions.quota, exact: true }),
  ).toBeDisabled();

  // Crossing one TB during refresh must preserve the unit of the active draft.
  const saveLimit = async () => {
    await page.getByRole('button', { name: m.actions.quota, exact: true }).click();
    await page.getByRole('button', { name: all.common.confirm, exact: true }).click();
  };
  await quota.fill('1024');
  await saveLimit();
  await expect(quota).toHaveAttribute('placeholder', '1024');
  await saveLimit();
  await expect.poll(() => writes.map((write) => write.limit_bytes)).toEqual([
    2 ** 40, 2 ** 40,
  ]);

  // Switch unit to TB and enter 1.5 TB -> 1,649,267,441,664 bytes.
  await page.locator('article .ant-select-selector').click();
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByTitle(m.quotaUnits.TB, { exact: true })
    .click();
  await quota.fill('1.5');
  await page
    .getByRole('button', { name: m.actions.quota, exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page
    .getByRole('button', { name: all.common.confirm, exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]).toMatchObject({
    action: 'quota',
    limit_bytes: 1.5 * 2 ** 40,
  });
  await fits(page, info);
});

test('unmatched teacher homepage jumps to catalog teacher search in page state without URL query params', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const catalogQueries = [];
  await page.route('**/api/v1/catalog/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/teacher-sites/refresh')) {
      return route.fulfill({
        json: {
          latest: null,
          counts: { teaching: 10, official: 5, both: 4, eligible: 11 },
        },
      });
    }
    if (url.pathname.endsWith('/teacher-sites/unmatched')) {
      return route.fulfill({
        json: {
          items: [
            {
              site_id: 'site-1',
              name: 'Zhang Wei',
              unit: 'School of CS',
              reason: 'ambiguous_catalog',
              candidate_count: 2,
            },
          ],
          total: 1,
          reason_counts: { ambiguous_catalog: 1 },
          next: '',
          revision: 1,
          observed_at: '2026-11-15T00:00:00Z',
        },
      });
    }
    const kind = url.searchParams.get('kind');
    if (url.pathname === '/api/v1/catalog/admin/objects') {
      catalogQueries.push(Object.fromEntries(url.searchParams));
      return route.fulfill({
        json: {
          items: [
            {
              id: 'teacher-zw',
              kind: 'teacher',
              school_id: 'school',
              name: 'Zhang Wei',
              credits: null,
              aliases: [],
              revision: 1,
              updated_at: '2026-11-01T00:00:00Z',
            },
          ],
          next: '',
        },
      });
    }
    return route.fulfill({
      json: {
        items:
          kind === 'school'
            ? [
                {
                  id: 'school',
                  kind: 'school',
                  school_id: 'school',
                  name: 'Demo University',
                  credits: null,
                  aliases: [],
                  revision: 1,
                  updated_at: '2026-11-01T00:00:00Z',
                },
              ]
            : [],
        next: '',
      },
    });
  });

  await page.goto(
    `${base}/catalog/teacher-sites?lang=${info.project.metadata.locale}`,
  );
  await page
    .getByRole('button', { name: all.teacherSites.checkCatalog, exact: true })
    .click();
  await expect(page).toHaveURL(`${base}/catalog`);
  expect(new URL(page.url()).searchParams.get('state')).toBeNull();
  expect(new URL(page.url()).hash).toBe('');
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.locator('#catalogview-field-1')).toHaveValue('Zhang Wei');
  await expect
    .poll(() => catalogQueries.at(-1))
    .toMatchObject({ kind: 'teacher', q: 'Zhang Wei', school_id: 'school' });
  await fits(page, info);
});

test('catalog import preview displays state counts and filters rows by change status in page state', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  await page.route('**/api/v1/catalog/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/imports/preview')) {
      return route.fulfill({
        json: {
          valid: true,
          code: 'ok',
          preview_token: 'tok-1',
          changes: [
            { id: 'c-new', kind: 'course', state: 'new', fields: ['name'] },
            {
              id: 'c-conflict',
              kind: 'course',
              state: 'conflict',
              fields: ['credits'],
            },
          ],
        },
      });
    }
    return route.fulfill({
      json: {
        items: [
          {
            id: 'school',
            kind: 'school',
            school_id: 'school',
            name: 'Demo University',
            credits: null,
            aliases: [],
            revision: 1,
            updated_at: '2026-11-01T00:00:00Z',
          },
        ],
        next: '',
      },
    });
  });

  await page.goto(`${base}/catalog/imports?lang=${info.project.metadata.locale}`);
  await expect(page.locator('#import-file')).toBeEnabled();
  await page.locator('#import-file').setInputFiles({
    name: 'catalog.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        school_id: 'school',
        source_id: 'registrar',
        revision: 1,
        fetched_at: '2026-11-15T00:00:00Z',
        objects: [],
        enrollments: [],
      }),
    ),
  });
  await page
    .getByRole('button', { name: all.catalog.previewImport, exact: true })
    .click();
  await expect(page.getByRole('cell', { name: 'c-new', exact: true })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'c-conflict', exact: true }),
  ).toBeVisible();

  await page
    .locator('.ant-form-item')
    .filter({ hasText: all.catalog.changeFilter })
    .locator('.ant-select-selector')
    .click();
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: all.catalog.changeState.conflict })
    .click();
  expect(new URL(page.url()).searchParams.get('state')).toBeNull();
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('cell', { name: 'c-new', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('cell', { name: 'c-conflict', exact: true }),
  ).toBeVisible();
  await fits(page, info);
});

test('administrator trust requires current owner consent and a confirmed command', async ({ page }, info) => {
  const all = catalogue(info); const m = all.storage;
  const instance = { ...storageExample.instances[0], adapter: 'bhpan', account_hint: '5***4', trusted: false };
  const writes = [];
  await page.route('**/api/v1/storage/operations**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body.revision).toBe(instance.revision);
      writes.push({ body, key: request.headers()['idempotency-key'] });
      instance.trusted = body.action === 'trust';
      instance.revision++;
      return route.fulfill({ json: instance });
    }
    return route.fulfill({ json: { ...storageExample, instances: [instance] } });
  });
  await page.goto(`${base}/storage?lang=${info.project.metadata.locale}`);
  const trust = page.getByRole('button', { name: m.actions.trust, exact: true });
  await expect(trust).toBeDisabled();
  instance.trust_consent = { classes: ['quarantine', 'restricted'], scope: 'school', source: 'owner_session',
    until: '2099-12-31T23:59:59Z', recorded_at: '2026-11-24T00:00:00Z' };
  await page.getByRole('button', { name: all.common.refresh, exact: true }).click();
  await expect(trust).toBeEnabled();
  await trust.click();
  expect(writes).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button', {name: all.common.confirm, exact: true}).click();
  const untrust = page.getByRole('button', { name: m.actions.untrust, exact: true });
  await expect(untrust).toBeVisible();
  await untrust.click();
  await page.getByRole('dialog').getByRole('button', {name: all.common.confirm, exact: true}).click();
  await expect(trust).toBeVisible();
  expect(writes.map(w => w.body.action)).toEqual(['trust','untrust']);
  expect(writes[0].key).toBeTruthy();
  expect(writes[0].key).not.toBe(writes[1].key);
});
