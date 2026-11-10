import fs from 'node:fs';

import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8'));
const base = 'http://127.0.0.1:18786';
function watch(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (/\[intlify\].*(Not found|Fall back)/i.test(message.text())) errors.push(message.text()); });
  return errors;
}
async function fits(page, info) {
  await expect(page.locator('html')).toHaveAttribute('dir', info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
const example = JSON.parse(fs.readFileSync('contracts/contribution.example.json', 'utf8'));

test('operator retry preserves conditions, retains uncertain request and clears revoked inventory', async ({ page }, info) => {
  const all = catalogue(info); const m = all.contribution; const c = all.common; const errors = watch(page); const requests = [];
  let reject = false;
  await page.route('**/api/v1/storage-contributions**', async (route) => {
    if (reject) return route.fulfill({ status: 403, json: { code: 'denied' } });
    if (route.request().method() === 'POST') {
      requests.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
      if (requests.length === 1) return route.abort();
      return route.fulfill({ status: 202, json: { ...example.page.items[0], revision: 2, state: 'pending' } });
    }
    return route.fulfill({ json: { ...example.page, items: [{ ...example.page.items[0], state: 'blocked', reason: 'authorization_required', desired_state: 'exiting', exit_target_at: '2030-01-02T00:00:00Z' }] } });
  });
  await page.goto(`${base}/storage/contributions?lang=${info.project.metadata.locale}`);
  await expect(page.locator('article')).toContainText(m.reasons.authorization_required);
  await fits(page, info);
  await page.getByRole('button', { name: m.actions.retry, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(m.adminHint);
  await page.getByRole('button', { name: c.confirm, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(c.uncertain);
  await page.getByRole('button', { name: c.retryOriginal, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0].body).toEqual({ revision: 1 });
  const next = page.waitForRequest((request) => request.method() === 'GET' && new URL(request.url()).searchParams.get('after') === 'fixture-next');
  await page.getByRole('button', { name: c.next, exact: true }).click();
  await next;
  await expect(page.locator('article')).toHaveCount(1);
  expect(errors).toEqual([]);
  reject = true;
  await page.getByRole('button', { name: c.refresh, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(all.errors.forbidden);
  await expect(page.locator('article')).toHaveCount(0);
});

test('operator login boundary recovers to an empty page', async ({ page }, info) => {
  const all = catalogue(info); const c = all.common;
  let allowed = false;
  await page.route('**/api/v1/storage-contributions**', (route) => (allowed ? route.fulfill({ json: { items: [], next_cursor: '' } }) : route.fulfill({ status: 401, json: { code: 'authentication_required' } })));
  await page.goto(`${base}/storage/contributions?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('alert')).toContainText(all.errors.unauthenticated);
  await expect(page.locator('article')).toHaveCount(0);
  allowed = true;
  await page.getByRole('button', { name: c.refresh, exact: true }).click();
  await expect(page.getByText(c.empty, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: c.next, exact: true })).toHaveCount(0);
});
