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

test('overview counts pending refunds, new feedback, student and teacher verifications beyond 25 history rows, and hides refused cards', async ({
  page,
}, info) => {
  await schoolSession(page);
  await page.route('**/api/v1/admin/legal/documents**', (route) =>
    route.fulfill({ status: 403, json: { code: 'forbidden' } }),
  );
  const all = catalogue(info);
  const num = (value) =>
    new Intl.NumberFormat(info.project.metadata.locale).format(value);

  await page.route('**/api/v1/admin/modules', (route) =>
    route.fulfill({
      json: [
        { id: 'platform', state: 'ready', health: 'available' },
        { id: 'billing', state: 'ready', health: 'degraded' },
      ],
    }),
  );
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
            updated_at: '2026-09-01T00:00:00Z',
          },
        ],
        next: '',
      },
    }),
  );
  await page.route('**/api/v1/moderation/tasks**', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/api/v1/moderation/feedback**', (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (Number(query.get('limit')) > 50) return route.fulfill({ status: 400, json: { code: 'invalid_input' } });
    return route.fulfill({
      json: {
        items: [
          {
            id: query.get('after') || 'f-1',
            sender: 'stu@demo.edu',
            subject: 'Question',
            body: 'Body',
            authentication_results: '',
            suspicious: false,
            state: 'new',
            assignee: '',
            note: '',
            revision: 1,
            received_at: '2026-11-15T00:00:00Z',
            closed_at: null,
            attachments: [],
            replies: [],
          },
        ],
        next_cursor: query.get('after') ? '' : 'f-2',
      },
    });
  });

  // 30 approved history rows followed by 2 pending_review rows: limit=100 prevents false zero.
  const makeApp = (id, kind, state) => ({
    id,
    school_id: 'school',
    method: 'manual_material_review',
    stage: 'bachelor',
    kind,
    state,
    revision: 1,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
    expires_at: '2026-12-01T00:00:00Z',
    credential_id: '',
    result_code: '',
  });
  const studentApps = [
    ...Array.from({ length: 30 }, (_, idx) =>
      makeApp(`hist-${idx}`, 'student', 'approved'),
    ),
    makeApp('pend-1', 'student', 'pending_review'),
    makeApp('pend-2', 'student', 'pending_review'),
  ];
  await page.route('**/api/v1/admin/verification/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/teacher-applications')) {
      return route.fulfill({
        json: [makeApp('t-1', 'teacher', 'pending_review')],
      });
    }
    return route.fulfill({ json: studentApps });
  });

  const refundOrder = (id, state) => ({
    id,
    kind: 'refund',
    state,
    amount_minor: 1500,
    points: 0,
    reference: 'ref',
    channel: 'alipay',
    reason: 'Refund',
    created_at: '2026-11-01T00:00:00Z',
    allocations: [],
    original_points: 0,
    original_amount_minor: 1500,
    receipt_reference: '',
    failure_code: '',
    target: { issuer: 'https://id.example.invalid', subject: 'u-1' },
  });
  await page.route('**/api/v1/billing/admin/refunds**', (route) => {
    const state = new URL(route.request().url()).searchParams.get('state');
    return route.fulfill({
      json: {
        items:
          state === 'submitted'
            ? [refundOrder('r-1', 'submitted'), refundOrder('r-2', 'submitted')]
            : [refundOrder(state === 'needs_review' ? 'r-4' : 'r-3', state)],
        next: '',
      },
    });
  });

  // Open-platform returns 403 forbidden: card must hide without marking todos failed.
  let denyApps = true;
  let appPages = 0;
  await page.route('**/api/v1/open-platform/admin/apps**', (route) => {
    if (denyApps) return route.fulfill({ status: 403, json: { code: 'open_platform_forbidden' } });
    appPages++;
    return route.fulfill({ json: { items: [], next: `page-${appPages}` } });
  });

  // Storage fails transiently on first attempt, then recovers on retry.
  let storageFail = true;
  await page.route('**/api/v1/storage/operations**', (route) => {
    if (storageFail) {
      storageFail = false;
      return route.fulfill({ status: 503, json: { code: 'unavailable' } });
    }
    return route.fulfill({ json: storageExample });
  });

  await page.goto(`${base}/?lang=${info.project.metadata.locale}`);

  const cardOf = (label) =>
    page.getByRole('link').filter({ has: page.getByText(label, { exact: true }) });

  await expect(cardOf(all.overview.todo.refunds)).toContainText(num(4));
  await expect(cardOf(all.overview.todo.feedback)).toContainText(num(2));
  await expect(cardOf(all.overview.todo.verification)).toContainText(num(2));
  await expect(cardOf(all.overview.todo.teacherVerification)).toContainText(
    num(1),
  );
  await expect(
    page.getByText(all.overview.todo.openPlatform, { exact: true }),
  ).toHaveCount(0);

  // Storage failed on first load: warning alert and unknown marker appear, then retry succeeds.
  await expect(
    page.getByText(all.overview.todoFailed, { exact: true }),
  ).toBeVisible();
  await expect(cardOf(all.overview.todo.storage)).toContainText(
    all.overview.todoUnknown,
  );
  denyApps = false;
  await page
    .getByRole('button', { name: all.overview.todoRetry, exact: true })
    .click();
  await expect(
    page.getByText(all.overview.todoFailed, { exact: true }),
  ).toHaveCount(0);
  await expect(cardOf(all.overview.todo.storage)).toContainText(
    num(storageExample.jobs.blocked),
  );
  await expect(cardOf(all.overview.todo.openPlatform)).toContainText(all.overview.todoUnknown);
  expect(appPages).toBe(5);
  await fits(page, info);
});
