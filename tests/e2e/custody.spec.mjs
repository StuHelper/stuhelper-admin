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

test('custody administration resumes original consent without credential access', async ({ page }, info) => {
  const all = catalogue(info); const m = all.custody; const c = all.common; const errors = watch(page); const posts = [];
  const item = { id: '00000000-0000-4000-8000-000000000001', adapter: 'bhpan', revision: 2, state: 'blocked', authorization_expires_at: '2030-01-01T00:00:00Z', request_id: '00000000-0000-4000-8000-000000000002', last_error: 'result_unknown' };
  let reject = false;
  await page.route('**/api/v1/storage/custody**', async (route) => {
    if (reject) return route.fulfill({ status: 403, json: { code: 'denied' } });
    const request = route.request();
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON());
      if (posts.length === 1) return route.abort();
      item.state = 'ready';
      item.last_error = '';
      return route.fulfill({ status: 202, json: item });
    }
    return route.fulfill({ json: { items: [item], next_cursor: '' } });
  });
  await page.goto(`${base}/storage/custody?lang=${info.project.metadata.locale}`);
  await expect(page.getByText(m.reasons.result_unknown, { exact: true })).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await fits(page, info);
  await page.getByRole('button', { name: m.resume, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText(m.uncertain);
  await page.getByRole('button', { name: m.retryRecovery, exact: true }).click();
  await expect(page.getByText(m.states.ready, { exact: true })).toBeVisible();
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[0]).toEqual({ request_id: item.request_id, revision: 2 });
  reject = true;
  await page.getByRole('button', { name: c.refresh, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(all.errors.forbidden);
  await expect(page.getByText(m.states.ready, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('custody administration handles unauthenticated and empty states', async ({ page }, info) => {
  const all = catalogue(info); const c = all.common;
  let allowed = false;
  await page.route('**/api/v1/storage/custody**', (route) => (allowed ? route.fulfill({ json: { items: [], next_cursor: '' } }) : route.fulfill({ status: 401, json: { code: 'authentication_required' } })));
  await page.goto(`${base}/storage/custody?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('alert')).toContainText(all.errors.unauthenticated);
  allowed = true;
  await page.getByRole('button', { name: c.refresh, exact: true }).click();
  await expect(page.getByText(c.empty, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: c.next, exact: true })).toHaveCount(0);
});
