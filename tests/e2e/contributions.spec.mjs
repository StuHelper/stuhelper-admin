import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '../session-fixture.mjs';
const example = JSON.parse(fs.readFileSync('contracts/contribution.example.json', 'utf8'));
function messages(info) { return JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8')).contribution; }
test('operator retry preserves conditions, retains uncertain request and clears revoked inventory', async ({ page }, info) => {
  const errors = []; const m = messages(info); const requests = [];
  let reject = false;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (/\[intlify\].*(Not found|Fall back)/i.test(e.text())) errors.push(e.text()); });
  await page.route('**/api/v1/storage-contributions**', async route => {
    if (reject) return route.fulfill({ status: 403, json: { code: 'denied' } });
    if (route.request().method() === 'POST') {
      requests.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
      if (requests.length === 1) return route.abort();
      return route.fulfill({ status: 202, json: { ...example.page.items[0], revision: 2, state: 'pending' } });
    }
    return route.fulfill({ json: { ...example.page, items: [{ ...example.page.items[0], state: 'blocked', reason: 'authorization_required', desired_state: 'exiting', exit_target_at: '2030-01-02T00:00:00Z' }] } });
  });
  await page.goto(`http://127.0.0.1:18786/contributions?lang=${info.project.metadata.locale}`);
  await expect(page.locator('article')).toContainText(m.reasons.authorization_required);
  await expect(page.locator('html')).toHaveAttribute('dir', info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: m.actions.retry, exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(m.adminHint);
  await page.getByRole('button', { name: m.confirmButton, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(m.uncertain);
  await page.getByRole('button', { name: m.retryOriginal, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]); expect(requests[0].body).toEqual({ revision: 1 });
  const next = page.waitForRequest(r => r.method() === 'GET' && new URL(r.url()).searchParams.get('after') === 'fixture-next');
  await page.getByRole('button', { name: m.next, exact: true }).click(); await next;
  await expect(page.locator('article')).toHaveCount(1); expect(errors).toEqual([]);
  if (process.env.CONTRIBUTION_SCREENSHOTS) { fs.mkdirSync(process.env.CONTRIBUTION_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.CONTRIBUTION_SCREENSHOTS, `admin-${info.project.name}.png`), fullPage: true }); }
  reject = true; await page.getByRole('button', { name: m.refresh, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(m.errors.forbidden); await expect(page.locator('article')).toHaveCount(0);
});
test('operator login boundary recovers to an empty page', async ({ page }, info) => {
  const m = messages(info); let allowed = false;
  await page.route('**/api/v1/storage-contributions**', route => allowed ? route.fulfill({ json: { items: [], next_cursor: '' } }) : route.fulfill({ status: 401, json: { code: 'authentication_required' } }));
  await page.goto(`http://127.0.0.1:18786/contributions?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('status')).toContainText(m.errors.unauthenticated); await expect(page.locator('article')).toHaveCount(0);
  allowed = true; await page.getByRole('button', { name: m.refresh, exact: true }).click();
  await expect(page.getByText(m.empty, { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: m.next, exact: true })).toBeDisabled();
});
