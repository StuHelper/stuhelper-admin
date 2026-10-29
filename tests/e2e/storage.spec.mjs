import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '../session-fixture.mjs';

const example = JSON.parse(fs.readFileSync('contracts/storage-operations.example.json', 'utf8'));
const endpoint = '**/api/v1/storage/operations**';
function messages(testInfo) {
  const locale = testInfo.project.metadata.locale;
  return { locale, ...JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${locale}/page.json`, 'utf8')).storage };
}
test('translated operation, original-request retry, pagination and permission revocation', async ({ page }, info) => {
  const errors = []; const m = messages(info); const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/\[intlify\].*(Not found|Fall back)/i.test(message.text())) errors.push(message.text()); });
  let reject = false;
  await page.route(endpoint, async route => {
    if (reject) return route.fulfill({ status: 403, json: { code: 'storage_denied' } });
    if (route.request().method() === 'POST') {
      requests.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
      if (requests.length === 1) return route.abort();
      return route.fulfill({ json: { ...example.instances[0], state: 'paused', revision: 2 } });
    }
    return route.fulfill({ json: { ...example, next_cursor: 'fixture-object', failures_next_cursor: 'fixture-job' } });
  });
  await page.goto(`http://127.0.0.1:18786/storage?lang=${m.locale}`);
  await expect(page.getByRole('heading', { name: 'fixture-instance', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', m.locale === 'ar-EG' ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', m.locale);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const quota = page.getByLabel(m.quotaInput);
  await quota.fill('1');
  await expect(page.getByRole('button', { name: m.actions.quota, exact: true })).toBeDisabled();
  await quota.fill('2048');
  await expect(page.getByRole('button', { name: m.actions.quota, exact: true })).toBeEnabled();
  const pause = page.getByRole('button', { name: m.actions.pause, exact: true });
  await pause.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: m.confirmButton, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(m.uncertain);
  await page.getByRole('button', { name: m.retryOriginal, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByRole('heading', { name: 'fixture-instance', exact: true })).toBeVisible();
  const next = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).searchParams.get('after') === 'fixture-object');
  await page.getByRole('button', { name: m.nextObjects, exact: true }).click(); await next;
  await expect(page.getByRole('heading', { name: 'fixture-instance', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  if (process.env.STORAGE_SCREENSHOTS) {
    fs.mkdirSync(process.env.STORAGE_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.STORAGE_SCREENSHOTS, `${info.project.name}.png`), fullPage: true });
  }
  reject = true;
  await page.getByRole('button', { name: m.refresh, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(m.errors.forbidden);
  await expect(page.getByRole('heading', { name: 'fixture-instance', exact: true })).toHaveCount(0);
});

test('access boundary and empty response recover without local identity', async ({ page }, info) => {
  const m = messages(info);
  let authorized = false;
  await page.route(endpoint, route => authorized ? route.fulfill({ json: { ...example, instances: [], objects: [], failures: [], jobs: { pending: 0, running: 0, blocked: 0 } } }) : route.fulfill({ status: 401, json: { code: 'authentication_required' } }));
  await page.goto(`http://127.0.0.1:18786/storage?lang=${m.locale}`);
  await expect(page.getByRole('status')).toContainText(m.errors.unauthenticated);
  await expect(page.locator('article')).toHaveCount(0);
  authorized = true;
  await page.getByRole('button', { name: m.refresh, exact: true }).click();
  await expect(page.getByText(m.empty, { exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: m.nextFailures, exact: true })).toBeDisabled();
});
