import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';
test.beforeEach(async ({page})=>{await schoolSession(page)});

const base = 'http://127.0.0.1:18786';

test('session settings preserve edits on conflict and revoke only the confirmed subject', async ({ page }, info) => {
  const writes = [];
  let conflict = true;
  let version = 1;
  await page.route('**/api/v1/admin/session-policy', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { interval_minutes: 30, grace_minutes: 30, version } });
    writes.push(route.request().postDataJSON());
    if (conflict) return route.fulfill({ status: 409, json: { code: 'session_policy_conflict' } });
    version += 1;
    return route.fulfill({ json: { interval_minutes: writes.at(-1).interval_minutes, grace_minutes: writes.at(-1).grace_minutes, version } });
  });
  const revocations = [];
  await page.route('**/api/v1/admin/sessions/revoke', route => { revocations.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true } }); });
  await page.goto(`${base}/system/sessions?lang=${info.project.metadata.locale}`);
  const interval = page.locator('#session-review');
  await expect(interval).toHaveValue('30');
  await interval.fill('15');
  await page.locator('#session-grace').fill('0');
  // Native labels, focus and form submission work with the keyboard.
  await page.locator('#session-grace').press('Tab');
  await expect(page.locator('form').first().locator('button[type="submit"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(interval).toHaveValue('15');
  await expect(page.locator('#session-grace')).toHaveValue('0');
  expect(writes).toEqual([{ interval_minutes: 15, grace_minutes: 0, expected_version: 1 }]);
  conflict = false;
  await page.locator('form').first().locator('button[type="submit"]').click();
  const text=JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`,'utf8')).sessionPolicy;
  await expect(page.getByRole('status')).toHaveText(text.saved);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.locator('#session-subject').fill('synthetic-subject');
  const revoke = page.locator('form').last().locator('button[type="submit"]');
  await expect(revoke).toBeDisabled();
  await page.getByRole('checkbox').check();
  await revoke.click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  expect(revocations).toEqual([{ subject: 'synthetic-subject' }]);
  if(info.project.metadata.locale==='ar-EG')await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('session settings show a retryable outage without losing input', async ({ page }, info) => {
  let unavailable = false;
  await page.route('**/api/v1/admin/session-policy', route => unavailable ? route.fulfill({ status: 503, json: { code: 'unavailable' } }) : route.fulfill({ json: { interval_minutes: 30, grace_minutes: 30, version: 1 } }));
  await page.goto(`${base}/system/sessions?lang=${info.project.metadata.locale}`);
  await expect(page.locator('#session-review')).toHaveValue('30');
  await page.locator('#session-review').fill('20');
  unavailable = true;
  await page.locator('form').first().locator('button[type="submit"]').click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.locator('#session-review')).toHaveValue('20');
});
