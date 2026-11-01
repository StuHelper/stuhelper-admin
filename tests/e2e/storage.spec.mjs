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
const example = JSON.parse(fs.readFileSync('contracts/storage-operations.example.json', 'utf8'));
const endpoint = '**/api/v1/storage/operations**';

test('translated operation, original-request retry, pagination and permission revocation', async ({ page }, info) => {
  const all = catalogue(info); const m = all.storage; const c = all.common; const errors = watch(page); const requests = [];
  let reject = false;
  await page.route(endpoint, async (route) => {
    if (reject) return route.fulfill({ status: 403, json: { code: 'storage_denied' } });
    if (route.request().method() === 'POST') {
      requests.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
      if (requests.length === 1) return route.abort();
      return route.fulfill({ json: { ...example.instances[0], state: 'paused', revision: 2 } });
    }
    return route.fulfill({ json: { ...example, next_cursor: 'fixture-object', failures_next_cursor: 'fixture-job' } });
  });
  await page.goto(`${base}/storage?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('heading', { name: 'fixture-instance', exact: true })).toBeVisible();
  await fits(page, info);
  const quota = page.getByLabel(m.quotaInput);
  await quota.fill('1');
  await expect(page.getByRole('button', { name: m.actions.quota, exact: true })).toBeDisabled();
  await quota.fill('2048');
  await expect(page.getByRole('button', { name: m.actions.quota, exact: true })).toBeEnabled();
  const pause = page.getByRole('button', { name: m.actions.pause, exact: true });
  await pause.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: c.confirm, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(c.uncertain);
  await page.getByRole('button', { name: c.retryOriginal, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await page.getByRole('tab', { name: m.objects, exact: true }).click();
  const next = page.waitForRequest((request) => request.method() === 'GET' && new URL(request.url()).searchParams.get('after') === 'fixture-object');
  await page.getByRole('button', { name: c.next, exact: true }).click();
  await next;
  expect(errors).toEqual([]);
  reject = true;
  await page.getByRole('button', { name: c.refresh, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(all.errors.forbidden);
  await expect(page.getByRole('heading', { name: 'fixture-instance', exact: true })).toHaveCount(0);
});

test('access boundary and empty response recover without local identity', async ({ page }, info) => {
  const all = catalogue(info); const m = all.storage; const c = all.common;
  let authorized = false;
  await page.route(endpoint, (route) => (authorized ? route.fulfill({ json: { ...example, instances: [], objects: [], failures: [], jobs: { pending: 0, running: 0, blocked: 0 }, next_cursor: '', failures_next_cursor: '' } }) : route.fulfill({ status: 401, json: { code: 'authentication_required' } })));
  await page.goto(`${base}/storage?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('alert')).toContainText(all.errors.unauthenticated);
  await expect(page.locator('article')).toHaveCount(0);
  authorized = true;
  await page.getByRole('button', { name: c.refresh, exact: true }).click();
  await expect(page.getByText(c.empty, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: m.failures, exact: true }).click();
  await expect(page.getByRole('button', { name: c.next, exact: true })).toBeDisabled();
});
