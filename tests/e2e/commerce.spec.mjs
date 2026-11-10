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
const target = { issuer: 'https://id.example.invalid', subject: 'user-1' };
const order = (values) => ({ amount_minor: 0, points: 0, reference: '', channel: '', reason: '', created_at: '2026-11-01T00:00:00Z', allocations: [], original_points: 0, original_amount_minor: 0, receipt_reference: '', failure_code: '', ...values });
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

// Billing 0.3.1 and resources 0.5.0 servers. Writes are recorded with their idempotency keys.
async function server(page, options = {}) {
  const s = fixture();
  await routes(page, s);
  const state = {
    plans: [
      { id: 'semester', name: 'Semester pass', valid_seconds: 120 * 86_400, enabled: true, points: 300, ivory_minor: 1500, version: 2 },
      { id: 'draft', name: 'Draft plan', valid_seconds: 30 * 86_400, enabled: false, points: 100, ivory_minor: null, version: 1 },
    ],
    coverage: { semester: { plan_id: 'semester', revision: 3, rules: [{ school_id: 'school' }] } },
    price: options.price ?? null,
    writes: [],
    reads: [],
  };
  await page.route('**/api/v1/billing/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/billing', '');
    if (request.method() === 'GET') {
      state.reads.push(`${path}${url.search}`);
      if (path === '/admin/membership-plans') return route.fulfill({ json: state.plans });
      if (path === '/resource-prices/resource') return state.price ? route.fulfill({ json: state.price }) : route.fulfill({ status: 404, json: { code: 'billing_not_found' } });
      if (path === '/admin/refunds') return route.fulfill({ json: { items: url.searchParams.get('state') === 'awaiting_manual' ? [order({ id: 'r1', kind: 'refund', state: 'awaiting_manual', amount_minor: 1000, target })] : [], next: '' } });
      if (path === '/admin/refunds/r1/payee') return options.payee ? route.fulfill({ json: options.payee }) : route.fulfill({ status: 404, json: { code: 'billing_not_found' } });
      if (path === '/admin/accounts') return route.fulfill({ json: { target, wallet: { points: 40, ivory_minor: 2500, frozen_ivory_minor: 0, debt_points: 0, frozen: false }, orders: { items: [order({ id: 'u1', kind: 'resource_unlock', state: 'fulfilled', points: 80, account: 'points', resource_id: 'resource' }), order({ id: 'm1', kind: 'membership', state: 'succeeded', amount_minor: 1500, account: 'ivory', plan_id: 'semester' })], next: '' }, ledger: { items: [], next: '' } } });
      return route.fulfill({ status: 404, json: { code: 'billing_not_found' } });
    }
    const body = request.method() === 'DELETE' ? undefined : request.postDataJSON();
    state.writes.push({ method: request.method(), path, body, key: request.headers()['idempotency-key'] });
    if (path.startsWith('/admin/membership-plans/')) {
      const id = path.split('/').at(-1);
      if (request.method() === 'DELETE') {
        state.plans = state.plans.map((plan) => (plan.id === id ? { ...plan, enabled: false, version: plan.version + 1 } : plan));
        return route.fulfill({ json: state.plans.find((plan) => plan.id === id) });
      }
      const current = state.plans.find((plan) => plan.id === id);
      if (current && current.version !== body.version) return route.fulfill({ status: 409, json: { code: 'billing_conflict' } });
      const saved = { ...body, version: body.version + 1 };
      state.plans = current ? state.plans.map((plan) => (plan.id === id ? saved : plan)) : [...state.plans, saved];
      return route.fulfill({ json: saved });
    }
    if (path === '/admin/resource-prices/resource') {
      state.price = body;
      return route.fulfill({ json: body });
    }
    if (path === '/admin/memberships/grants') return route.fulfill({ json: order({ id: 'g1', kind: 'membership', state: 'succeeded', account: 'points', plan_id: body.plan_id }) });
    if (path === '/admin/commerce-refunds') return route.fulfill({ json: order({ id: body.order_id, kind: 'resource_unlock', state: 'refunded', points: 80, account: 'points' }) });
    return route.fulfill({ status: 404, json: { code: 'billing_not_found' } });
  });
  await page.route('**/api/v1/resources/coverage/**', async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').at(-1);
    if (request.method() === 'GET') return state.coverage[id] ? route.fulfill({ json: state.coverage[id] }) : route.fulfill({ status: 404, json: { code: 'resources_not_found' } });
    const body = request.postDataJSON();
    state.writes.push({ method: 'PUT', path: `/coverage/${id}`, body, key: request.headers()['idempotency-key'] });
    state.coverage[id] = { ...body, revision: body.revision + 1 };
    return route.fulfill({ json: state.coverage[id] });
  });
  return state;
}

test('a plan is saved with the version that was read, and a plan without coverage is marked', async ({ page }, info) => {
  const all = catalogue(info); const m = all.billing.memberships; const errors = watch(page); const state = await server(page);
  await page.goto(`${base}/billing/memberships?lang=${info.project.metadata.locale}`);
  const semester = page.getByRole('row').filter({ hasText: 'semester' });
  await expect(semester.getByText(fill(m.ruleCount, { count: new Intl.NumberFormat(info.project.metadata.locale).format(1) }), { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Draft plan' }).getByText(m.noCoverage, { exact: true })).toBeVisible();
  await semester.getByRole('button', { name: all.common.edit, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.locator('#plan-id')).toBeDisabled();
  await drawer.locator('#plan-name').fill('Semester pass plus');
  await drawer.locator('#plan-ivory').fill('0');
  await expect(drawer.getByText(m.ivoryInvalid, { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: all.common.save, exact: true })).toBeDisabled();
  await drawer.locator('#plan-ivory').fill('12.5');
  await drawer.getByRole('button', { name: all.common.save, exact: true }).click();
  await expect(drawer.getByText(all.common.saved, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ method: 'PUT', path: '/admin/membership-plans/semester', key: expect.any(String), body: { id: 'semester', name: 'Semester pass plus', valid_seconds: 120 * 86_400, enabled: true, points: 300, ivory_minor: 1250, version: 2 } }]);
  await fits(page, info);
  expect(errors).toEqual([]);
});

test('coverage rules are saved with the revision that was read', async ({ page }, info) => {
  const all = catalogue(info); const m = all.billing.memberships; const errors = watch(page); const state = await server(page);
  await page.goto(`${base}/billing/memberships?lang=${info.project.metadata.locale}`);
  await page.getByRole('row').filter({ hasText: 'semester' }).getByRole('button', { name: m.editCoverage, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByRole('group', { name: fill(m.rule, { index: new Intl.NumberFormat(info.project.metadata.locale).format(1) }) })).toBeVisible();
  await drawer.getByRole('button', { name: m.addRule, exact: true }).click();
  const second = drawer.getByRole('group', { name: fill(m.rule, { index: new Intl.NumberFormat(info.project.metadata.locale).format(2) }) });
  await second.locator('.ant-select').nth(1).click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle(/自定义试卷|Custom papers/).click();
  await second.locator('.ant-select').first().click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle(/资料目录|Resource folder/).click();
  await drawer.getByRole('button', { name: all.common.save, exact: true }).click();
  await expect(drawer.getByText(all.common.saved, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ method: 'PUT', path: '/coverage/semester', key: expect.any(String), body: { plan_id: 'semester', revision: 3, rules: [{ school_id: 'school' }, { school_id: 'school', directory_id: 'folder', category_id: 'custom-category' }] } }]);
  await drawer.locator('.ant-drawer-close').click();
  await expect(page.getByRole('row').filter({ hasText: 'semester' }).getByText(fill(m.ruleCount, { count: new Intl.NumberFormat(info.project.metadata.locale).format(2) }), { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('stopping sales asks for confirmation and keeps the plan listed as not on sale', async ({ page }, info) => {
  const all = catalogue(info); const m = all.billing.memberships; const state = await server(page);
  await page.goto(`${base}/billing/memberships?lang=${info.project.metadata.locale}`);
  const semester = page.getByRole('row').filter({ hasText: 'semester' });
  await semester.getByRole('button', { name: m.stop, exact: true }).click();
  await page.locator('.ant-popconfirm .ant-btn-primary').click();
  await expect(semester.getByText(all.billing.config.disabled, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ method: 'DELETE', path: '/admin/membership-plans/semester', key: expect.any(String), body: undefined }]);
});

test('an administrator grants a membership and refunds a resource unlock in full', async ({ page }, info) => {
  const all = catalogue(info); const a = all.billing.accounts; const errors = watch(page); const state = await server(page);
  await page.goto(`${base}/billing/accounts?lang=${info.project.metadata.locale}`);
  await page.locator('#billing-issuer').fill(target.issuer);
  await page.locator('#billing-subject').fill(target.subject);
  await page.getByRole('button', { name: all.common.search, exact: true }).click();
  await expect(page.getByText(all.billing.kind.resource_unlock, { exact: true })).toBeVisible();
  await expect(page.getByText(all.billing.orderState.fulfilled, { exact: true })).toBeVisible();

  await page.getByRole('row').filter({ hasText: all.billing.kind.resource_unlock }).getByRole('button', { name: a.refundCommerce, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#commerce-refund-points')).toHaveCount(0);
  const confirm = dialog.getByRole('button', { name: a.confirmRefund });
  await expect(confirm).toBeDisabled();
  await dialog.locator('#commerce-refund-reason').fill('File was corrupted.');
  await confirm.click();
  await expect(page.getByText(a.commerceRefunded, { exact: true })).toBeVisible();
  expect(state.writes[0]).toEqual({ method: 'POST', path: '/admin/commerce-refunds', key: expect.any(String), body: { target, order_id: 'u1', amount: 80, reason: 'File was corrupted.' } });

  // Narrow tab bars measure their overflow after the first render; click again until the tab is selected.
  const tab = page.getByRole('tab', { name: a.membership, exact: true });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
  }).toPass();
  await page.locator('.ant-form-item').filter({ hasText: a.plan }).locator('.ant-select-selector').click();
  await expect(page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-disabled')).toHaveCount(1);
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle('Semester pass · semester').click();
  await page.locator('#billing-membership-reason').fill('Event reward.');
  await page.getByRole('button', { name: a.membershipSubmit, exact: true }).last().click();
  await expect(page.getByText(a.membershipGranted, { exact: true })).toBeVisible();
  expect(state.writes[1]).toEqual({ method: 'POST', path: '/admin/memberships/grants', key: expect.any(String), body: { target, plan_id: 'semester', reason: 'Event reward.' } });
  await fits(page, info);
  expect(errors).toEqual([]);
});

test('a membership refund may be partial but not above the price paid', async ({ page }, info) => {
  const all = catalogue(info); const a = all.billing.accounts; const state = await server(page);
  await page.goto(`${base}/billing/accounts?lang=${info.project.metadata.locale}`);
  await page.locator('#billing-issuer').fill(target.issuer);
  await page.locator('#billing-subject').fill(target.subject);
  await page.getByRole('button', { name: all.common.search, exact: true }).click();
  await page.getByRole('row').filter({ hasText: all.billing.kind.membership }).getByRole('button', { name: a.refundCommerce, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#commerce-refund-reason').fill('Service outage.');
  await dialog.locator('#commerce-refund-ivory').fill('15.01');
  await expect(dialog.getByRole('button', { name: a.confirmRefund })).toBeDisabled();
  await dialog.locator('#commerce-refund-ivory').fill('7.50');
  await dialog.getByRole('button', { name: a.confirmRefund }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body).toEqual({ target, order_id: 'm1', amount: 750, reason: 'Service outage.' });
});

test('payee details are read only on request and a missing record is stated', async ({ page }, info) => {
  const all = catalogue(info); const r = all.billing.refunds; const state = await server(page, { payee: { method: 'bank', name: 'Li Hua', account: '6222 0000 1111' } });
  await page.goto(`${base}/billing/refunds?lang=${info.project.metadata.locale}`);
  await page.locator('.ant-segmented').getByText(all.billing.orderState.awaiting_manual, { exact: true }).click();
  await page.getByRole('button', { name: r.handle, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByText(r.payeeHint, { exact: true })).toBeVisible();
  expect(state.reads.some((read) => read.includes('/payee'))).toBe(false);
  await drawer.getByRole('button', { name: r.showPayee, exact: true }).click();
  await expect(drawer.getByText('6222 0000 1111', { exact: true })).toBeVisible();
  expect(state.reads.filter((read) => read.includes('/payee'))).toEqual([`/admin/refunds/r1/payee?issuer=${encodeURIComponent(target.issuer)}&subject=user-1`]);
  await drawer.locator('.ant-drawer-close').click();
  await page.getByRole('button', { name: r.handle, exact: true }).click();
  await expect(drawer.getByText('6222 0000 1111', { exact: true })).toHaveCount(0);
});

test('a refund without payee details says so', async ({ page }, info) => {
  const all = catalogue(info); const r = all.billing.refunds; await server(page);
  await page.goto(`${base}/billing/refunds?lang=${info.project.metadata.locale}`);
  await page.locator('.ant-segmented').getByText(all.billing.orderState.awaiting_manual, { exact: true }).click();
  await page.getByRole('button', { name: r.handle, exact: true }).click();
  await page.locator('.ant-drawer-content').getByRole('button', { name: r.showPayee, exact: true }).click();
  await expect(page.getByText(r.noPayee, { exact: true })).toBeVisible();
});

test('an unpriced resource is priced from the manage panel', async ({ page }, info) => {
  const all = catalogue(info); const p = all.resources.price; const state = await server(page);
  await page.goto(`${base}/resources?lang=${info.project.metadata.locale}`);
  await page.getByRole('button', { name: all.common.manage, exact: true }).click();
  await expect(page.getByText(p.unpriced, { exact: true })).toBeVisible();
  const save = page.getByRole('button', { name: p.save, exact: true });
  await expect(save).toBeDisabled();
  await page.locator('#resource-price-points').fill('80');
  await save.click();
  await expect(page.getByText(p.hint, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ method: 'PUT', path: '/admin/resource-prices/resource', key: expect.any(String), body: { resource_id: 'resource', points: 80, ivory_minor: null } }]);
});
