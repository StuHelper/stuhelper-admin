import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { expect, test } from 'playwright/test';

test('custody administration resumes original consent without credential access', async ({ page }, info) => {
  const messages = JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8')); const m = messages.custody;
  const item = { id: '00000000-0000-4000-8000-000000000001', adapter: 'bhpan', revision: 2, state: 'blocked', authorization_expires_at: '2030-01-01T00:00:00Z', request_id: '00000000-0000-4000-8000-000000000002', last_error: 'result_unknown' };
  const errors = []; const posts = []; let reject = false;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (/\[intlify\].*(Not found|Fall back)/i.test(e.text())) errors.push(e.text()); });
  await page.route('**/api/v1/storage/custody**', async route => {
    if (reject) return route.fulfill({ status: 403, json: { code: 'denied' } });
    const request = route.request();
    if (request.method() === 'POST') { posts.push(request.postDataJSON()); if (posts.length === 1) return route.abort(); item.state = 'ready'; item.last_error = ''; return route.fulfill({ status: 202, json: item }); }
    return route.fulfill({ json: { items: [item], next_cursor: '' } });
  });
  await page.goto(`http://127.0.0.1:18786/storage-accounts?lang=${info.project.metadata.locale}`);
  await expect(page.locator('article')).toContainText(m.reasons.result_unknown); await expect(page.locator('input[type=password]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('dir', info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#__app-loading__')).toHaveCount(0);
  if (process.env.CUSTODY_SCREENSHOTS) { fs.mkdirSync(process.env.CUSTODY_SCREENSHOTS,{recursive:true}); await page.screenshot({path:path.join(process.env.CUSTODY_SCREENSHOTS,`admin-${info.project.name}.png`),fullPage:true}); }
  await page.getByRole('button', { name: m.resume, exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(m.adminUncertain); await page.getByRole('button', { name: m.retryRecovery, exact: true }).click();
  await expect(page.locator('article')).toContainText(m.states.ready); expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]); expect(posts[0]).toEqual({ request_id: item.request_id, revision: 2 });
  reject = true; await page.getByRole('button', { name: m.refresh, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(messages.contribution.errors.forbidden); await expect(page.locator('article')).toHaveCount(0); expect(errors).toEqual([]);
});

test('custody administration handles unauthenticated and empty states', async ({ page }, info) => {
  const messages = JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8')); const m = messages.custody;
  let allowed = false;
  await page.route('**/api/v1/storage/custody**', route => allowed ? route.fulfill({ json: { items: [], next_cursor: '' } }) : route.fulfill({ status: 401, json: { code: 'authentication_required' } }));
  await page.goto(`http://127.0.0.1:18786/storage-accounts?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('status')).toContainText(messages.contribution.errors.unauthenticated);
  allowed = true; await page.getByRole('button', { name: m.refresh, exact: true }).click(); await expect(page.getByText(m.empty, { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: m.next, exact: true })).toBeDisabled();
});
