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
import { fixture, routes } from './resource-fixture.mjs';

async function open(page, info, path) {
  const all = catalogue(info); const errors = watch(page); const s = fixture();
  await routes(page, s);
  await page.goto(`${base}${path}?lang=${info.project.metadata.locale}`);
  return { all, m: all.resources, c: all.common, s, errors };
}
const lost = (s) => { s.lose = true; };

test('category configuration preserves stable ids, fields and original-request retry', async ({ page }, info) => {
  const { m, c, s, errors } = await open(page, info, '/resources/categories');
  await page.getByRole('button', { name: c.edit, exact: true }).click();
  await page.getByRole('group', { name: m.names, exact: true }).first().getByLabel(m.languageNames['zh-CN']).fill('按配置更名');
  lost(s);
  await page.getByRole('button', { name: c.save, exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: c.retryOriginal, exact: true }).click();
  const writes = () => s.calls.filter((call) => call.method === 'PUT' && call.path.startsWith('/categories/'));
  await expect.poll(() => writes().length).toBe(2);
  expect(writes()[0].key).toBe(writes()[1].key);
  expect(writes()[0].body).toEqual(writes()[1].body);
  expect(s.category.id).toBe('custom-category');
  expect(s.category.names['zh-CN']).toBe('按配置更名');
  expect(s.category.group_by).toBe('edition');
  expect(s.category.fields[0].kind).toBe('integer');
  await fits(page, info);
  expect(errors).toEqual([]);
});

test('grant creation and revocation retain the subject and respect current permissions', async ({ page }, info) => {
  const { all, m, c, s, errors } = await open(page, info, '/resources');
  await page.getByRole('button', { name: c.manage, exact: true }).click();
  await page.getByLabel(m.subjectKey, { exact: true }).fill('issuer:reader');
  await page.getByRole('button', { name: m.grant, exact: true }).click();
  await expect(page.getByText('issuer:reader', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.revoke, exact: true }).click();
  await page.locator('.ant-popconfirm .ant-btn-primary').click();
  await expect(page.getByText(m.revoked, { exact: true })).toBeVisible();
  const grants = s.calls.filter((call) => call.path.includes('/grants/'));
  expect(grants).toHaveLength(2);
  expect(grants[1].body).toMatchObject({ subject_key: 'issuer:reader', revoked: true, revision: 1 });
  await page.locator('.ant-drawer-close').click();
  s.reject = true;
  await page.getByRole('button', { name: c.search, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(all.errors.forbidden);
  await expect(page.getByText('issuer:reader', { exact: true })).toHaveCount(0);
  await fits(page, info);
  expect(errors).toEqual([]);
});

test('review reads the pending file and retries an unknown decision without duplication', async ({ page }, info) => {
  const { all, m, c, s, errors } = await open(page, info, '/resources/reviews');
  await page.getByRole('button', { name: c.open, exact: true }).click();
  await expect(page.getByText('Fixture notes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.downloadFile, exact: true }).click();
  await expect.poll(() => s.calls.filter((call) => call.path === '/review/version/file').length).toBe(1);
  await page.getByLabel(c.reason, { exact: true }).fill('Verified content and source');
  lost(s);
  await page.getByRole('button', { name: all.moderation.applyDecision, exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: c.retryOriginal, exact: true }).click();
  const decisions = () => s.calls.filter((call) => call.path.endsWith('/decisions'));
  await expect.poll(() => decisions().length).toBe(2);
  expect(decisions()[0].key).toBe(decisions()[1].key);
  expect(decisions()[0].body).toEqual(decisions()[1].body);
  expect(decisions()[0].body.decision).toMatchObject({ object_id: 'resource:version', revision: 2, action: 'publish' });
  await expect(page.locator('.ant-drawer .ant-alert-success')).toBeVisible();
  await fits(page, info);
  expect(errors).toEqual([]);
});

test('directory editing saves revision and configured names', async ({ page }, info) => {
  const { m, c, s, errors } = await open(page, info, '/resources/directories');
  await page.getByRole('button', { name: c.edit, exact: true }).click();
  await page.getByRole('group', { name: m.names, exact: true }).getByLabel(m.languageNames['zh-CN']).fill('更名后的目录');
  await page.getByRole('button', { name: c.save, exact: true }).click();
  await expect.poll(() => s.directory.names['zh-CN']).toBe('更名后的目录');
  expect(s.directory.id).toBe('folder');
  expect(s.directory.revision).toBe(2);
  await fits(page, info);
  expect(errors).toEqual([]);
});

test('review keeps its input through reload protection and shows the object in the result', async ({ page }, info) => {
  const { all, c, s } = await open(page, info, '/resources/reviews');
  await page.getByRole('button', { name: c.open, exact: true }).click();
  await page.getByLabel(c.reason, { exact: true }).fill('Unsaved reason');
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await page.getByRole('button', { name: all.moderation.applyDecision, exact: true }).click();
  await expect.poll(() => s.calls.filter((call) => call.path.endsWith('/decisions')).length).toBe(1);
  await expect(page.locator('.ant-alert-success').first()).toContainText('Fixture notes');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('no school choice appears and a failed school lookup offers one retry', async ({ page }, info) => {
  const all = catalogue(info);
  await page.route('**/api/v1/catalog/objects**', (route) => route.fulfill({ status: 503, json: { code: 'unavailable' } }));
  await page.goto(`${base}/resources?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('button', { name: all.common.reloadCampus, exact: true })).toHaveCount(1);
  await expect(page.getByLabel(all.common.school)).toHaveCount(0);
});
