import fs from 'node:fs';

import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8'));
const cny = (info, minor) => new Intl.NumberFormat(info.project.metadata.locale, { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
const base = 'http://127.0.0.1:18786';
const target = { issuer: 'https://id.example.invalid', subject: 'user-1' };
const order = (values) => ({ points: 0, reference: 'topup-1', channel: 'demo-pay', reason: 'Charged by mistake.', created_at: '2026-11-01T00:00:00Z', allocations: [], original_points: 0, original_amount_minor: 0, receipt_reference: '', failure_code: '', ...values });
const rule = { id: 'review-published', version: 2, effective_at: '2026-10-01T00:00:00Z', enabled: true, points: 5, valid_seconds: 0, period_seconds: 86_400, limit: 3, object_scoped: true };

// Billing server following the billing contract. Writes are recorded with their idempotency keys.
async function server(page) {
  const state = { refunds: [order({ id: 'r1', kind: 'refund', state: 'submitted', amount_minor: 3000, target }), order({ id: 'r2', kind: 'refund', state: 'awaiting_manual', amount_minor: 1000, receipt_reference: 'rcpt-9', target }), order({ id: 'r3', kind: 'refund', state: 'needs_review', amount_minor: 500, target })], offers: [{ id: 'points-120', enabled: true, amount_minor: 1000, points: 120, valid_seconds: 30 * 86_400, version: 3 }], writes: [], reads: [] };
  await page.route('**/api/v1/billing/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/billing/admin', '');
    if (request.method() === 'GET') {
      state.reads.push(`${path}${url.search}`);
      if (path === '/refunds') return route.fulfill({ json: { items: state.refunds.filter((item) => item.state === url.searchParams.get('state')), next: '' } });
      if (path === '/channels') return route.fulfill({ json: { items: [{ id: 'demo-pay', enabled: false, amounts_minor: [1000, 3000], original_refunds: true }], next: '' } });
      if (path === '/offers') return route.fulfill({ json: { items: state.offers, next: '' } });
      if (path === '/rules') return route.fulfill({ json: { items: [rule], next: '' } });
      if (path === '/accounts') return route.fulfill({ json: { target, wallet: { points: 40, ivory_minor: 2500, frozen_ivory_minor: 0, debt_points: 0, frozen: false }, orders: { items: [order({ id: 'p1', kind: 'purchase', state: 'succeeded', amount_minor: 1000, points: 120, reference: 'points-120' })], next: '' }, ledger: { items: [{ id: 'e1', asset: 'points', kind: 'reward', amount: 5, reference: 'ev', created_at: '2026-11-02T00:00:00Z' }], next: '' } } });
      return route.fulfill({ status: 404, json: { code: 'billing_not_found' } });
    }
    const body = request.postDataJSON();
    state.writes.push({ path, body, key: request.headers()['idempotency-key'] });
    if (path === '/refunds/r1/review') return route.fulfill({ json: order({ id: 'r1', kind: 'refund', state: 'processing', amount_minor: 3000 }) });
    if (path === '/orders/r3/payment-review') return route.fulfill({ json: order({ id: 'r3', kind: 'refund', state: 'review_query_pending', amount_minor: 500 }) });
    if (path === '/refunds/r2/manual-result') return route.fulfill({ json: order({ id: 'r2', kind: 'refund', state: 'succeeded', amount_minor: 1000 }) });
    if (path === '/offers/points-120') {
      if (body.version !== state.offers[0].version) return route.fulfill({ status: 409, json: { code: 'billing_closure_conflict' } });
      state.offers = [{ ...body, version: body.version + 1 }];
      return route.fulfill({ json: state.offers[0] });
    }
    if (path === '/rewards') return route.fulfill({ json: { event_id: body.event.event_id, rule_id: body.event.rule_id, version: 2, points: 5, state: 'granted', occurred_at: body.event.occurred_at, lot_id: 'lot', revoked: false } });
    return route.fulfill({ status: 404, json: { code: 'billing_not_found' } });
  });
  return state;
}

test('a submitted refund is approved for manual payout and the payout result is recorded', async ({ page }, info) => {
  const all = catalogue(info); const b = all.billing; const state = await server(page);
  await page.goto(`${base}/billing/refunds?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('cell', { name: cny(info, 3000), exact: true })).toBeVisible();
  await page.getByRole('button', { name: b.refunds.handle, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await drawer.getByRole('radio', { name: b.refunds.reject, exact: true }).check();
  const confirmReject = drawer.getByRole('button', { name: b.refunds.confirmReject, exact: true });
  await expect(confirmReject).toBeDisabled();
  await drawer.getByRole('radio', { name: b.refunds.approve, exact: true }).check();
  await drawer.getByRole('checkbox', { name: b.refunds.manual, exact: true }).check();
  await drawer.getByRole('button', { name: b.refunds.confirmApprove, exact: true }).click();
  await expect(drawer.getByText(b.refunds.done.approved, { exact: true })).toBeVisible();
  expect(state.writes[0]).toEqual({ path: '/refunds/r1/review', key: expect.any(String), body: { target, approve: true, manual: true, reason: '' } });
  await drawer.locator('.ant-drawer-close').click();
  await expect(page.getByText(b.refunds.empty, { exact: true })).toBeVisible();

  await page.getByText(b.orderState.awaiting_manual, { exact: true }).click();
  await page.getByRole('button', { name: b.refunds.handle, exact: true }).click();
  await expect(drawer.getByText('rcpt-9', { exact: true })).toBeVisible();
  const record = drawer.getByRole('button', { name: b.refunds.record, exact: true });
  await expect(record).toBeDisabled();
  await drawer.getByLabel(b.refunds.paymentReference).fill('bank-777');
  await expect(record).toBeDisabled();
  await drawer.getByLabel(b.refunds.paymentChannel).fill('bank-a-corporate');
  await record.click();
  await expect(drawer.getByText(b.refunds.done.paid, { exact: true })).toBeVisible();
  expect(state.writes[1]).toEqual({ path: '/refunds/r2/manual-result', key: expect.any(String), body: { target, succeeded: true, payment_channel: 'bank-a-corporate', payment_reference: 'bank-777', reason: '' } });
});

test('an offer is saved with the version that was read and disabled channels are listed', async ({ page }, info) => {
  const all = catalogue(info); const c = all.billing.config; const state = await server(page);
  await page.goto(`${base}/billing/config?lang=${info.project.metadata.locale}`);
  await expect(page.getByText(c.disabled, { exact: true })).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'points-120' }).getByRole('button', { name: all.common.edit, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.locator('#billing-config-id')).toBeDisabled();
  await drawer.getByLabel(c.price).fill('12.5');
  await drawer.getByRole('button', { name: all.common.save, exact: true }).click();
  await expect(drawer.getByText(all.common.saved, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ path: '/offers/points-120', key: expect.any(String), body: { id: 'points-120', enabled: true, amount_minor: 1250, points: 120, valid_seconds: 30 * 86_400, version: 3 } }]);
});

test('an account lookup shows the wallet and a reward is granted once per event', async ({ page }, info) => {
  const all = catalogue(info); const a = all.billing.accounts; const state = await server(page);
  await page.goto(`${base}/billing/accounts?lang=${info.project.metadata.locale}`);
  await page.getByLabel(all.billing.issuer).fill(target.issuer);
  await page.getByLabel(all.billing.subject).fill(target.subject);
  await page.getByRole('button', { name: all.common.search, exact: true }).click();
  await expect(page.getByText(a.wallet, { exact: true })).toBeVisible();
  expect(state.reads).toContain(`/accounts?issuer=${encodeURIComponent(target.issuer)}&subject=user-1&orders_limit=50&ledger_limit=50`);
  await expect(page.getByRole('button', { name: a.refundPurchase, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: a.grant, exact: true }).click();
  await page.locator('.ant-form-item').filter({ hasText: a.rule }).locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
  const grant = page.getByRole('button', { name: a.grantSubmit, exact: true });
  // The rule counts per item, so the item is required.
  await expect(grant).toBeDisabled();
  await page.getByLabel(a.object).fill('review-42');
  await grant.click();
  await expect(page.getByText(a.rewardState.granted, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ path: '/rewards', key: expect.any(String), body: { target, event: { event_id: expect.stringMatching(/^[0-9a-f-]{36}$/), rule_id: 'review-published', object_id: 'review-42', occurred_at: expect.any(String) } } }]);
});

test('a refund whose automatic queries ran out gets one more query with cited evidence', async ({ page }, info) => {
  const all = catalogue(info); const b = all.billing; const state = await server(page);
  await page.goto(`${base}/billing/refunds?lang=${info.project.metadata.locale}`);
  await page.getByText(b.orderState.needs_review, { exact: true }).click();
  await page.getByRole('button', { name: b.refunds.handle, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  const submit = drawer.getByRole('button', { name: b.review.submit, exact: true });
  await expect(submit).toBeDisabled();
  await drawer.getByLabel(b.review.evidence).fill('ticket-55');
  await drawer.getByLabel(all.common.reason).fill('Channel was down during the night.');
  await submit.click();
  await expect(drawer.getByText(b.refunds.done.review.retry_query, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ path: '/orders/r3/payment-review', key: expect.any(String), body: { target, action: 'retry_query', reason: 'Channel was down during the night.', evidence_reference: 'ticket-55' } }]);
});
