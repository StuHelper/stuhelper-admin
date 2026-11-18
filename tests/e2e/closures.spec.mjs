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

test.beforeEach(async ({ page }) => {
  await schoolSession(page);
});

const blockedItem = () => ({
  id: '00000000-0000-4000-8000-000000000010',
  profile_id: '00000000-0000-4000-8000-000000000099',
  state: 'processing',
  revision: 2,
  requested_at: '2026-10-01T00:00:00Z',
  cooling_ends_at: '2026-10-08T00:00:00Z',
  completed_steps: ['assets', 'sessions'],
  skipped_modules: ['open-platform'],
  blocker: 'content_unavailable',
  points_policy: 'forfeit_all_points_and_pending_deductions',
});

const coolingItem = () => ({
  id: '00000000-0000-4000-8000-000000000011',
  profile_id: '00000000-0000-4000-8000-000000000088',
  state: 'cooling',
  revision: 1,
  requested_at: '2026-11-17T00:00:00Z',
  cooling_ends_at: '2030-01-01T00:00:00Z',
  completed_steps: [],
  blocker: '',
  points_policy: 'forfeit_all_points_and_pending_deductions',
});

test('administrator inspects blocked and cooling closures and resumes cleanup idempotently', async ({
  page,
}, info) => {
  const all = catalogue(info);
  const c = all.closures;
  let current = blockedItem();
  let networkLost = true;
  let denied = false;
  const keys = [];

  await page.route('**/api/v1/profiles/admin/closures**', async (route) => {
    if (denied)
      return route.fulfill({ status: 403, json: { code: 'forbidden' } });
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/process')) {
      keys.push(request.headers()['idempotency-key']);
      if (networkLost) {
        networkLost = false;
        return route.abort();
      }
      current = {
        ...current,
        state: 'closed',
        blocker: '',
        completed_steps: ['assets', 'sessions', 'authorizations', 'content'],
        completed_at: '2026-11-18T01:00:00Z',
        revision: 3,
      };
      return route.fulfill({ status: 202, json: current });
    }
    if (path.endsWith(`/${current.id}`)) return route.fulfill({ json: current });
    if (path.endsWith(`/${coolingItem().id}`))
      return route.fulfill({ json: coolingItem() });
    return route.fulfill({ json: { items: [current, coolingItem()] } });
  });

  await page.goto(`${base}/system/closures?lang=${info.project.metadata.locale}`);
  await expect(
    page.getByText('00000000-0000-4000-8000-000000000099', { exact: true }),
  ).toBeVisible();

  // Cooling closure keeps resume disabled before the seven-day deadline.
  await page
    .getByRole('row')
    .filter({ hasText: '00000000-0000-4000-8000-000000000088' })
    .getByRole('button', { name: all.common.open, exact: true })
    .click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(
    drawer.getByRole('button', { name: c.process, exact: true }),
  ).toBeDisabled();
  await drawer.locator('.ant-drawer-close').click();

  // Post-cooling blocked closure displays steps, skipped modules and resumes with original key on retry.
  await page
    .getByRole('row')
    .filter({ hasText: '00000000-0000-4000-8000-000000000099' })
    .getByRole('button', { name: all.common.open, exact: true })
    .click();
  await expect(
    drawer.getByText(c.blockers.content_unavailable, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    drawer.getByText(c.modules['open-platform'], { exact: true }),
  ).toBeVisible();

  await drawer.getByRole('button', { name: c.process, exact: true }).click();
  await expect(drawer.getByText(all.common.uncertain, { exact: true })).toBeVisible();
  await drawer
    .getByRole('button', { name: all.common.retryOriginal, exact: true })
    .click();
  await expect(drawer.getByText(c.completedNotice, { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);

  await drawer.locator('.ant-drawer-close').click();

  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  // Revoking permission clears private closure records immediately.
  denied = true;
  await page.getByRole('button', { name: all.common.refresh, exact: true }).click();
  await expect(
    page.getByText('00000000-0000-4000-8000-000000000099'),
  ).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText(all.errors.forbidden);
});
