import fs from 'node:fs';

import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8'));
function fill(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) out = out.replaceAll(`{${key}}`, value);
  return out;
}
const base = 'http://127.0.0.1:18786';
const any = { school: '*', group: '*', module: '*' };
const reviewer = { id: 'reviewer', name: 'Content reviewer', capabilities: ['reviews.moderate', 'resources.review'] };

// Platform administration server following the platform admin contract.
async function server(page, options = {}) {
  const state = { grants: options.grants ?? [], revision: 4, writes: [], reads: [] };
  await page.route('**/api/v1/platform/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/platform/admin', '');
    if (request.method() === 'GET') {
      state.reads.push(`${path}${url.search}`);
      if (path === '/role-templates') return route.fulfill({ json: [reviewer] });
      if (path === '/administrators/admin-1/effective') return route.fulfill({ json: { subject: 'admin-1', revision: String(state.revision), grants: state.grants, authorization_mode: 'explicit_grants' } });
      if (path === '/administrators/root/effective') return route.fulfill({ json: { subject: 'root', revision: '1', grants: [], authorization_mode: 'platform_admin_all' } });
      if (path === '/operations') return route.fulfill({ json: { source: 'platform', items: options.audit ?? [], next_cursor: '', partial: !!options.missing, missing_modules: options.missing ?? [], queried_modules: ['platform', 'billing'] } });
      return route.fulfill({ status: 404, json: { code: 'not_found' } });
    }
    const body = request.postDataJSON();
    state.writes.push({ method: request.method(), path, body, key: request.headers()['idempotency-key'] });
    if (body.expected_revision !== String(state.revision)) return route.fulfill({ status: 409, json: { code: 'conflict' } });
    state.revision += 1;
    state.grants = request.method() === 'PUT' ? [...state.grants, { role: reviewer, scope: body.scope }] : state.grants.filter((grant) => grant.role.id !== body.role_id);
    return route.fulfill({ json: { revision: String(state.revision) } });
  });
  return state;
}

test('granting a role within a school scope and revoking it with a reason', async ({ page }, info) => {
  const all = catalogue(info); const a = all.access; const state = await server(page);
  await page.goto(`${base}/system/roles?lang=${info.project.metadata.locale}`);
  await expect(page.getByText('Content reviewer', { exact: true })).toBeVisible();
  await page.getByLabel(a.subject).fill('admin-1');
  await page.getByRole('button', { name: all.common.search, exact: true }).click();
  await expect(page.getByText(a.noGrants, { exact: true })).toBeVisible();
  const grant = page.getByRole('button', { name: a.grant, exact: true });
  await page.getByLabel(a.roleId).fill('reviewer');
  await page.getByLabel(a.school, { exact: true }).fill('school-1');
  await expect(grant).toBeDisabled();
  await page.getByLabel(all.common.reason).fill('Joins the review team.');
  await grant.click();
  await expect(page.getByText(a.granted, { exact: true })).toBeVisible();
  expect(state.writes[0]).toEqual({ method: 'PUT', path: '/administrators/admin-1/grants', key: expect.any(String), body: { role_id: 'reviewer', scope: { school: 'school-1', group: '*', module: '*' }, expected_revision: '4', reason: 'Joins the review team.' } });

  await page.getByRole('row').filter({ hasText: 'Content reviewer' }).getByRole('button', { name: a.revoke, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: a.confirmRevoke, exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(all.common.reason).fill('Left the team.');
  await confirm.click();
  await expect(page.getByText(a.revoked, { exact: true })).toBeVisible();
  expect(state.writes[1]).toEqual({ method: 'DELETE', path: '/administrators/admin-1/grants', key: expect.any(String), body: { role_id: 'reviewer', scope: { school: 'school-1', group: '*', module: '*' }, expected_revision: '5', reason: 'Left the team.' } });
});

test('a platform administrator is shown as holding every capability', async ({ page }, info) => {
  const all = catalogue(info); const a = all.access;
  await server(page);
  await page.goto(`${base}/system/roles?lang=${info.project.metadata.locale}`);
  await page.getByLabel(a.subject).fill('root');
  await page.getByRole('button', { name: all.common.search, exact: true }).click();
  await expect(page.getByText(a.platformAdmin, { exact: true })).toBeVisible();
});

test('the operation log merges modules and names the modules that could not answer', async ({ page }, info) => {
  const all = catalogue(info); const u = all.audit;
  const record = { id: 'a1', source: 'billing', actor: 'admin-1', action: 'refund.review', target: 'order-9', scope: any, reason: 'Duplicate charge', result: 'success', created_at: '2026-11-08T01:00:00Z' };
  const state = await server(page, { audit: [record], missing: ['verification'] });
  await page.goto(`${base}/system/audit?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('cell', { name: 'order-9' })).toBeVisible();
  await expect(page.getByText(u.results.success, { exact: true })).toBeVisible();
  await expect(page.getByText(fill(u.partial, { modules: u.sources.verification }), { exact: true })).toBeVisible();
  await page.getByLabel(u.actor).fill('admin-1');
  await page.getByRole('button', { name: all.common.search, exact: true }).click();
  await expect.poll(() => state.reads.at(-1)).toBe('/operations?actor=admin-1&limit=50');
});
