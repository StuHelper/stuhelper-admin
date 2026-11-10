import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';
import { fixture, routes } from './resource-fixture.mjs';

const catalogue = (info) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8'));
function fill(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) out = out.replaceAll(`{${key}}`, value);
  return out;
}
const base = 'http://127.0.0.1:18786';
test.beforeEach(async ({ page }) => { await schoolSession(page); });
function watch(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (/\[intlify\].*(Not found|Fall back)/i.test(message.text())) errors.push(message.text()); });
  return errors;
}

// Platform eligibility server: one configuration version shared by every rule.
// A school without its own rule reads the platform default.
async function server(page, options = {}) {
  await routes(page, fixture());
  const state = { version: 7, site: { 'resources.purchase': ['campus_eligibility'], 'membership.purchase': ['campus_eligibility'] }, school: {}, writes: [] };
  await page.route('**/api/v1/platform/eligibility/**', async (route) => {
    const request = route.request();
    const [school, action] = new URL(request.url()).pathname.split('/').slice(-2).map((part) => decodeURIComponent(part));
    if (options.denySite && school === '*') return route.fulfill({ status: 403, json: { code: 'forbidden' } });
    const scope = school === '*' ? state.site : state.school;
    if (request.method() === 'GET') return route.fulfill({ json: { version: String(state.version), conditions: scope[action] ?? state.site[action] ?? ['content_access'] } });
    const body = request.postDataJSON();
    state.writes.push({ school, action, body, key: request.headers()['idempotency-key'] });
    if (body.expected_version !== String(state.version)) return route.fulfill({ status: 409, json: { code: 'conflict' } });
    state.version += 1;
    scope[action] = body.conditions;
    return route.fulfill({ json: { version: String(state.version), conditions: body.conditions } });
  });
  return state;
}

test('a school rule for buying resources is saved with the version read and leaves downloads unchanged', async ({ page }, info) => {
  const all = catalogue(info); const e = all.eligibility; const errors = watch(page); const state = await server(page);
  await page.goto(`${base}/system/eligibility?lang=${info.project.metadata.locale}`);
  const purchase = page.getByRole('row').filter({ hasText: 'resources.purchase' });
  await expect(purchase.getByText(e.conditions.campus_eligibility, { exact: true })).toHaveCount(2);
  await purchase.getByRole('button', { name: fill(e.edit.school, { action: 'resources.purchase' }), exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByText(e.schoolHint, { exact: true })).toBeVisible();
  const save = drawer.getByRole('button', { name: all.common.save, exact: true });
  await expect(save).toBeDisabled();
  await drawer.getByRole('checkbox', { name: e.conditions.identity_verified, exact: true }).check();
  await save.click();
  await expect(drawer.getByText(all.common.saved, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ school: 'school', action: 'resources.purchase', key: expect.any(String), body: { expected_version: '7', conditions: ['campus_eligibility', 'identity_verified'] } }]);
  await drawer.locator('.ant-drawer-close').click();
  await expect(purchase.getByText(e.conditions.identity_verified, { exact: true })).toHaveCount(1);
  const download = page.getByRole('row').filter({ hasText: 'resources.download.restricted' });
  await expect(download.getByText(e.conditions.identity_verified, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an empty rule requires only sign-in and a stale version is rejected', async ({ page }, info) => {
  const all = catalogue(info); const e = all.eligibility; const state = await server(page);
  await page.goto(`${base}/system/eligibility?lang=${info.project.metadata.locale}`);
  const membership = page.getByRole('row').filter({ hasText: 'membership.purchase' });
  await membership.getByRole('button', { name: fill(e.edit.site, { action: 'membership.purchase' }), exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await drawer.getByRole('checkbox', { name: e.conditions.campus_eligibility, exact: true }).uncheck();
  await expect(drawer.getByText(e.onlySignIn, { exact: true })).toBeVisible();
  state.version = 8;
  await drawer.getByRole('button', { name: all.common.save, exact: true }).click();
  await expect(drawer.getByRole('button', { name: all.common.reloadCompare, exact: true })).toBeVisible();
  expect(state.writes[0]).toMatchObject({ school: '*', action: 'membership.purchase', body: { expected_version: '7', conditions: [] } });
  expect(state.site['membership.purchase']).toEqual(['campus_eligibility']);
});

test('a column the administrator may not read shows the refusal and keeps the other column usable', async ({ page }, info) => {
  const all = catalogue(info); const e = all.eligibility; await server(page, { denySite: true });
  await page.goto(`${base}/system/eligibility?lang=${info.project.metadata.locale}`);
  const purchase = page.getByRole('row').filter({ hasText: 'resources.purchase' });
  await expect(purchase.getByText(all.errors.forbidden, { exact: true })).toBeVisible();
  await expect(purchase.getByRole('button', { name: fill(e.edit.school, { action: 'resources.purchase' }), exact: true })).toBeVisible();
  await expect(purchase.getByRole('button', { name: fill(e.edit.site, { action: 'resources.purchase' }), exact: true })).toHaveCount(0);
});
