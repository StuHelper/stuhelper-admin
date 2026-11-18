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
const storageExample = JSON.parse(
  fs.readFileSync('contracts/storage-operations.example.json', 'utf8'),
);
const base = 'http://127.0.0.1:18786';

test('overview hides forbidden todos, retries transient failures, and toggles module health details', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const num = (value) =>
    new Intl.NumberFormat(info.project.metadata.locale).format(value);
  let storageFails = true;

  await page.route('**/api/v1/catalog/objects**', (route) =>
    route.fulfill({
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
    }),
  );
  await page.route('**/api/v1/admin/modules', (route) =>
    route.fulfill({
      json: [
        { id: 'platform', state: 'ready', health: 'available' },
        { id: 'reviews', state: 'failed', health: 'unavailable' },
      ],
    }),
  );
  await page.route('**/api/v1/moderation/tasks**', (route) => {
    const u = new URL(route.request().url());
    const state = u.searchParams.get('state');
    const kind = u.searchParams.get('content_kind');
    const mk = (id, content_kind, taskKind = 'report') => ({
      id,
      school_id: 'school',
      content_kind,
      submission: {
        object_id: 'e-1',
        kind: taskKind,
        reason: 'Spam',
        evidence: [],
      },
      object_revision: 1,
      revision: 1,
      state,
      created_at: '2026-11-15T00:00:00Z',
      updated_at: '2026-11-15T01:00:00Z',
    });
    if (state === 'waiting' && kind === 'resource') {
      return route.fulfill({ json: [mk('t-r1', 'resource', 'review')] });
    }
    if (state === 'waiting') {
      return route.fulfill({
        json: [mk('t-1', 'review'), mk('t-2', 'review')],
      });
    }
    if (state === 'failed') {
      return route.fulfill({ json: [mk('t-f1', 'review')] });
    }
    if (state === 'applied') {
      return route.fulfill({ json: [mk('t-a1', 'review', 'report')] });
    }
    return route.fulfill({ json: [] });
  });
  await page.route(
    '**/api/v1/admin/verification/schools/school/applications**',
    (route) =>
      route.fulfill({
        status: 403,
        json: { code: 'forbidden', request_id: 'req-1' },
      }),
  );
  await page.route('**/api/v1/storage/operations**', (route) => {
    if (storageFails) {
      return route.fulfill({
        status: 503,
        json: { code: 'storage_unavailable', request_id: 'req-2' },
      });
    }
    return route.fulfill({
      json: {
        ...storageExample,
        jobs: { pending: 0, running: 0, blocked: 3 },
      },
    });
  });

  await page.goto(`${base}/?lang=${info.project.metadata.locale}`);
  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr',
  );

  const section = page.getByRole('region', {
    name: all.overview.todoTitle,
    exact: true,
  });
  await expect(
    section.getByText(all.overview.todo.moderation, { exact: true }),
  ).toBeVisible();
  // Forbidden verification count hides its card completely.
  await expect(
    section.getByText(all.overview.todo.verification, { exact: true }),
  ).toHaveCount(0);
  // Transient 503 marks storage count as unknown and offers retry.
  await expect(
    section.getByText(all.overview.todoUnknown, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(all.overview.todoFailed, { exact: true }),
  ).toBeVisible();

  storageFails = false;
  await page
    .getByRole('button', { name: all.overview.todoRetry, exact: true })
    .click();
  await expect(
    section.getByText(all.overview.todoUnknown, { exact: true }),
  ).toHaveCount(0);
  await expect(
    section
      .locator('a[href="/storage"]')
      .getByText(num(3), { exact: true }),
  ).toBeVisible();

  // Recent applied tasks and module health expansion.
  await expect(
    page.getByText(all.overview.recentTitle, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: all.overview.showModules, exact: true })
    .click();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'reviews' })
      .getByText(all.overview.healthStates.unavailable, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: all.overview.hideModules, exact: true })
    .click();
  await expect(page.getByRole('row').filter({ hasText: 'reviews' })).toHaveCount(
    0,
  );
});
