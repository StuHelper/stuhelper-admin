import { expect, test } from '../session-fixture.mjs';

const base = 'http://127.0.0.1:18786';
const paths = ['/billing/refunds', '/billing/accounts', '/billing/memberships', '/billing/config', '/qq/groups', '/qq/groups/group-1/settings', '/qq-binding', '/open-platform', '/system/lookup'];
const capabilities = ['billing.manage', 'groups.manage', 'qq-binding.manage', 'open-platform.manage', 'information-query.query'];

test('disabled module direct routes never mount business pages', async ({ page }) => {
  await page.route('**/api/v1/system/capabilities', route => route.fulfill({ json: { api_version: 1, capabilities: [] } }));
  const requests = [];
  page.on('request', request => { if (/\/api\/v1\/(billing|groups|qq-binding|open-platform|information-query)\//.test(request.url())) requests.push(request.url()); });
  for (const path of paths) {
    await page.goto(`${base}${path}`);
    await expect(page.locator('.ant-result-404')).toBeVisible();
  }
  expect(requests).toEqual([]);
});

test('menus follow deployment capabilities and discovery failure keeps entries', async ({ page }) => {
  await page.route('**/api/v1/system/capabilities', route => route.fulfill({ json: { api_version: 1, capabilities: [] } }));
  await page.goto(`${base}/system/roles`);
  await expect(page.locator('a[href="/system/roles"]').first()).toBeAttached();
  for (const path of paths) await expect(page.locator(`a[href="${path}"]`)).toHaveCount(0);
  await page.route('**/api/v1/system/capabilities', route => route.fulfill({ json: { api_version: 1, capabilities } }));
  await page.reload();
  await expect(page.locator('a[href="/qq/groups"]').first()).toBeAttached();
  await expect(page.locator('a[href="/qq-binding"]').first()).toBeAttached();
  await expect(page.locator('a[href="/open-platform"]').first()).toBeAttached();
  await page.route('**/api/v1/system/capabilities', route => route.fulfill({ status: 503, json: { code: 'unavailable' } }));
  await page.reload();
  await expect(page.locator('a[href="/qq/groups"]').first()).toBeAttached();
});
