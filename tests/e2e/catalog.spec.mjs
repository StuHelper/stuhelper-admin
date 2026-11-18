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
function fill(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}
const base = 'http://127.0.0.1:18786';

const schoolObj = {
  id: 'school',
  kind: 'school',
  school_id: 'school',
  name: 'Demo University',
  credits: null,
  aliases: [],
  revision: 1,
  updated_at: '2026-11-01T00:00:00Z',
};
const courseObj = (id, name, code, revision = 2) => ({
  id,
  kind: 'course',
  school_id: 'school',
  name,
  code,
  credits: 4,
  aliases: [],
  revision,
  updated_at: '2026-11-01T00:00:00Z',
});

test('catalog paged search appends courses, preserves edits across conflict reload, and merges duplicates after preview', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const c = all.catalog;
  const writes = [];
  let currentRevision = 2;
  let conflictOnce = true;

  await page.route('**/api/v1/catalog/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    if (req.method() === 'GET') {
      if (p.endsWith('/summary')) {
        const obj = courseObj('c-1', 'Algorithms', 'CS101', currentRevision);
        return route.fulfill({
          json: {
            object: obj,
            school: schoolObj,
            department: null,
            categories: [],
            natures: [],
            course_count: 2,
            teacher_count: 1,
            offering_count: 3,
          },
        });
      }
      if (p.endsWith('/objects')) {
        const kind = u.searchParams.get('kind');
        const q = u.searchParams.get('q') ?? '';
        const after = u.searchParams.get('after') ?? '';
        if (kind === 'school') {
          return route.fulfill({ json: { items: [schoolObj], next: '' } });
        }
        if (kind === 'course') {
          if (q === 'Algo' && !after) {
            return route.fulfill({
              json: {
                items: [courseObj('c-1', 'Algorithms', 'CS101', currentRevision)],
                next: 'cursor-2',
              },
            });
          }
          if (q === 'Algo' && after === 'cursor-2') {
            return route.fulfill({
              json: {
                items: [courseObj('c-2', 'Algorithms Lab', 'CS102', 1)],
                next: '',
              },
            });
          }
          return route.fulfill({
            json: {
              items: [
                courseObj('c-1', 'Algorithms', 'CS101', currentRevision),
                courseObj('c-2', 'Algorithms Lab', 'CS102', 1),
              ],
              next: '',
            },
          });
        }
        return route.fulfill({ json: { items: [], next: '' } });
      }
    }
    const body = req.postDataJSON();
    writes.push({
      method: req.method(),
      path: p,
      body,
      key: req.headers()['idempotency-key'],
    });
    if (req.method() === 'PATCH') {
      if (conflictOnce) {
        conflictOnce = false;
        currentRevision = 3;
        return route.fulfill({ status: 409, json: { code: 'conflict' } });
      }
      currentRevision = body.revision + 1;
      return route.fulfill({
        json: courseObj('c-1', body.name, 'CS101', currentRevision),
      });
    }
    if (p.endsWith('/merge-preview')) {
      return route.fulfill({
        json: {
          source: courseObj('c-1', 'Algorithms Updated', 'CS101', currentRevision),
          target: courseObj('c-2', 'Algorithms Lab', 'CS102', 1),
          aliases: 1,
          preview_token: 'merge-tok-1',
        },
      });
    }
    if (p.endsWith('/merge')) {
      return route.fulfill({
        json: courseObj('c-2', 'Algorithms Lab', 'CS102', 2),
      });
    }
    return route.fulfill({ status: 404, json: { code: 'not_found' } });
  });

  await page.goto(`${base}/catalog?lang=${info.project.metadata.locale}`);
  await page.locator('#catalogview-field-1').fill('Algo');
  await page
    .getByRole('button', { name: all.common.search, exact: true })
    .click();
  await expect(page.getByText('CS101', { exact: true })).toBeVisible();
  await expect(page.getByText('CS102', { exact: true })).toHaveCount(0);

  await page
    .getByRole('button', { name: all.common.loadMore, exact: true })
    .click();
  await expect(page.getByText('CS101', { exact: true })).toBeVisible();
  await expect(page.getByText('CS102', { exact: true })).toBeVisible();

  await page
    .getByRole('row')
    .filter({ hasText: 'CS101' })
    .getByRole('button', { name: all.common.edit, exact: true })
    .click();
  const drawer = page.locator('.ant-drawer-content');
  const nameInput = drawer.getByLabel(c.name, { exact: true });
  await expect(nameInput).toHaveValue('Algorithms');
  await nameInput.fill('Algorithms Updated');
  await drawer
    .getByRole('button', { name: all.common.save, exact: true })
    .click();

  const reloadBtn = drawer.getByRole('button', {
    name: all.common.reloadCompare,
    exact: true,
  });
  await expect(reloadBtn).toBeVisible();
  await reloadBtn.click();
  // Draft value is preserved while adopting latest revision 3.
  await expect(nameInput).toHaveValue('Algorithms Updated');
  await drawer
    .getByRole('button', { name: all.common.save, exact: true })
    .click();
  await expect(drawer.getByText(all.common.saved, { exact: true })).toBeVisible();
  expect(
    writes.filter((w) => w.method === 'PATCH').map((w) => w.body.revision),
  ).toEqual([2, 3]);

  // Lifecycle merge preview & confirm.
  await drawer.getByRole('tab', { name: c.lifecycle, exact: true }).click();
  await drawer
    .locator('.ant-form-item')
    .filter({ hasText: c.mergeTarget })
    .locator('.ant-select-selector')
    .click();
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByTitle('Algorithms Lab (CS102)', { exact: true })
    .click();
  await drawer.getByLabel(c.reason, { exact: true }).fill('Duplicate course code');
  await drawer
    .getByRole('button', { name: c.previewMerge, exact: true })
    .click();
  await drawer
    .getByRole('button', { name: c.confirmMerge, exact: true })
    .click();
  await expect(drawer.getByText(c.merged, { exact: true })).toBeVisible();
  expect(writes.find((w) => w.path.endsWith('/merge'))?.body.preview_token).toBe(
    'merge-tok-1',
  );
});

test('catalog import previews normalized JSON and retries an uncertain confirmation with the original key', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const c = all.catalog;
  const num = (value) =>
    new Intl.NumberFormat(info.project.metadata.locale).format(value);
  const confirmCalls = [];
  let failOnce = true;

  await page.route('**/api/v1/catalog/objects**', (route) =>
    route.fulfill({ json: { items: [schoolObj], next: '' } }),
  );
  await page.route('**/api/v1/catalog/imports/preview', (route) =>
    route.fulfill({
      json: {
        valid: true,
        code: '',
        preview_token: 'imp-tok-1',
        changes: [
          { id: 'c-1', kind: 'course', state: 'new', fields: ['name', 'code'] },
          { id: 'c-2', kind: 'course', state: 'updated', fields: ['credits'] },
        ],
      },
    }),
  );
  await page.route('**/api/v1/catalog/imports/confirm', (route) => {
    confirmCalls.push({
      body: route.request().postDataJSON(),
      key: route.request().headers()['idempotency-key'],
    });
    if (failOnce) {
      failOnce = false;
      return route.fulfill({ status: 504, json: { code: 'timeout' } });
    }
    return route.fulfill({
      json: {
        id: 'imp-1',
        objects: 2,
        enrollments: 0,
        preserved_corrections: 1,
      },
    });
  });

  await page.goto(
    `${base}/catalog/imports?lang=${info.project.metadata.locale}`,
  );
  await expect(page.locator('#import-file')).toBeEnabled();
  const payload = {
    school_id: 'school',
    source_id: 'academic-adapter',
    revision: 10,
    fetched_at: '2026-11-15T00:00:00Z',
    objects: [courseObj('c-1', 'Algorithms', 'CS101', 1)],
    enrollments: [],
  };
  await page.locator('#import-file').setInputFiles({
    name: 'catalog.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await expect(page.getByText('academic-adapter', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: c.previewImport, exact: true })
    .click();
  await expect(
    page.getByText(c.changeState.new, { exact: true }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: c.confirmImport, exact: true })
    .click();
  const retryBtn = page.getByRole('button', {
    name: all.common.retryOriginal,
    exact: true,
  });
  await expect(retryBtn).toBeVisible();
  await retryBtn.click();

  await expect(
    page.getByText(
      fill(c.imported, {
        objects: num(2),
        enrollments: num(0),
        preserved: num(1),
      }),
      { exact: true },
    ),
  ).toBeVisible();
  expect(confirmCalls).toHaveLength(2);
  expect(confirmCalls[0].key).toBeTruthy();
  expect(confirmCalls[1].key).toBe(confirmCalls[0].key);
  expect(confirmCalls[1].body.preview_token).toBe('imp-tok-1');
});
