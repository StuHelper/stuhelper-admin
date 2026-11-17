import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';
import { fixture, routes } from './resource-fixture.mjs';

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

test('feedback appends pages without overwriting earlier items and refunds switch between Segmented and Select by viewport', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const item = (id, subject) => ({
    id,
    sender: 'user@demo.edu',
    subject,
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
  });
  await page.route('**/api/v1/moderation/feedback**', (route) => {
    const after = new URL(route.request().url()).searchParams.get('after');
    return route.fulfill({
      json: after
        ? { items: [item('f-2', 'Second page mail')], next_cursor: '' }
        : { items: [item('f-1', 'First page mail')], next_cursor: 'c-1' },
    });
  });

  await page.goto(`${base}/moderation/feedback?lang=${info.project.metadata.locale}`);
  await expect(page.getByText('First page mail', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: all.feedback.next, exact: true })
    .click();
  await expect(page.getByText('First page mail', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Second page mail', { exact: true }),
  ).toBeVisible();

  await page.route('**/api/v1/billing/admin/refunds**', (route) =>
    route.fulfill({ json: { items: [], next: '' } }),
  );
  await page.goto(`${base}/billing/refunds?lang=${info.project.metadata.locale}`);
  const isMobile = info.project.name.startsWith('mobile-');
  await expect(page.locator('.ant-segmented')).toHaveCount(isMobile ? 0 : 1);
  if (isMobile) {
    await expect(page.locator('main .ant-select-selector').first()).toBeVisible();
  }
});

test('eligibility caps concurrent rule reads and refreshes only the edited row after saving', async ({
  page,
}, info) => {
  await schoolSession(page);
  await routes(page, fixture());
  const all = catalogue(info);
  const e = all.eligibility;
  let active = 0;
  let peak = 0;
  let reads = 0;
  let version = 7;

  await page.route('**/api/v1/platform/eligibility/**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      reads++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return route.fulfill({
        json: { version: String(version), conditions: ['campus_eligibility'] },
      });
    }
    const body = req.postDataJSON();
    version++;
    return route.fulfill({
      json: { version: String(version), conditions: body.conditions },
    });
  });

  await page.goto(`${base}/system/eligibility?lang=${info.project.metadata.locale}`);
  const purchase = page.getByRole('row').filter({ hasText: 'resources.purchase' });
  await expect(
    purchase.getByRole('button', {
      name: fill(e.edit.school, { action: 'resources.purchase' }),
      exact: true,
    }),
  ).toBeVisible();
  expect(reads).toBe(30);
  expect(peak).toBeLessThanOrEqual(6);

  const readsBeforeSave = reads;
  await purchase
    .getByRole('button', {
      name: fill(e.edit.school, { action: 'resources.purchase' }),
      exact: true,
    })
    .click();
  const drawer = page.locator('.ant-drawer-content');
  await drawer
    .getByRole('checkbox', { name: e.conditions.identity_verified, exact: true })
    .check();
  await drawer
    .getByRole('button', { name: all.common.save, exact: true })
    .click();
  await expect(drawer.getByText(all.common.saved, { exact: true })).toBeVisible();
  // Saving refreshes only the edited action's site + school cells (2 GETs, not 30).
  expect(reads - readsBeforeSave).toBe(2);
});
