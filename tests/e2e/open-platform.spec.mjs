import fs from 'node:fs';

import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8'));
const base = 'http://127.0.0.1:18786';
const policy = { grant_seconds: 0, token_seconds: 0, daily_quota: 0 };
const app = (values) => ({ id: 'app-1', name: 'Timetable widget', purpose: 'Shows the timetable.', redirect_uris: ['https://widget.example.invalid/cb'], requested_scopes: ['profile', 'schedule', 'qq_binding_details'], approved_scopes: [], client_type: 'confidential', state: 'pending', note: '', revision: 3, credential_revision: 0, policy, created_at: '2026-11-01T00:00:00Z', ...values });

// Open-platform administration following the contract; optionally the first review response is lost.
async function server(page, apps, { loseFirst = true } = {}) {
  const state = { apps, reviews: [] };
  await page.route('**/api/v1/open-platform/admin/apps**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { items: state.apps } });
    const body = request.postDataJSON();
    state.reviews.push({ body, key: request.headers()['idempotency-key'] });
    if (loseFirst && state.reviews.length === 1) return route.abort();
    if (body.revision !== state.apps[0].revision) return route.fulfill({ status: 409, json: { code: 'conflict' } });
    const next = { approve: 'active', changes_requested: 'changes_requested', suspend: 'suspended' }[body.decision];
    state.apps = [{ ...state.apps[0], state: next, approved_scopes: body.approved_scopes, policy: body.policy, note: body.note, revision: state.apps[0].revision + 1 }];
    return route.fulfill({ json: state.apps[0] });
  });
  return state;
}

test('approval sends the chosen scopes and limits and retries a lost result with the same request', async ({ page }, info) => {
  const all = catalogue(info); const o = all.openPlatform; const state = await server(page, [app({})]);
  await page.goto(`${base}/open-platform?lang=${info.project.metadata.locale}`);
  await page.getByRole('row').filter({ hasText: 'Timetable widget' }).getByRole('button', { name: o.review, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await drawer.getByRole('checkbox', { name: o.scopes.qq_binding_details, exact: true }).uncheck();
  await drawer.getByLabel(o.grantDays).fill('90');
  await drawer.getByRole('button', { name: o.submit.approve, exact: true }).click();
  await expect(drawer.getByText(all.common.uncertain, { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: all.common.retryOriginal, exact: true }).click();
  await expect(drawer.getByText(o.reviewed.active, { exact: true })).toBeVisible();
  expect(state.reviews).toHaveLength(2);
  expect(state.reviews[1]).toEqual(state.reviews[0]);
  expect(state.reviews[0].body).toEqual({ revision: 3, decision: 'approve', approved_scopes: ['profile', 'schedule'], policy: { grant_seconds: 90 * 86_400, token_seconds: 3600, daily_quota: 1000 }, note: '' });
});

test('requesting changes and suspending require a note visible to the developer', async ({ page }, info) => {
  const all = catalogue(info); const o = all.openPlatform; const state = await server(page, [app({ state: 'active', approved_scopes: ['profile'] })], { loseFirst: false });
  await page.goto(`${base}/open-platform?lang=${info.project.metadata.locale}`);
  await page.getByText(o.state.active, { exact: true }).first().click();
  await page.getByRole('row').filter({ hasText: 'Timetable widget' }).getByRole('button', { name: o.review, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByRole('radio', { name: o.decisions.changes_requested, exact: true })).toHaveCount(0);
  await drawer.getByRole('radio', { name: o.decisions.suspend, exact: true }).check();
  const submit = drawer.getByRole('button', { name: o.submit.suspend, exact: true });
  await expect(submit).toBeDisabled();
  await drawer.getByLabel(o.noteRequired).fill('Misused timetable data.');
  await submit.click();
  await expect(drawer.getByText(o.reviewed.suspended, { exact: true })).toBeVisible();
  expect(state.reviews.at(-1).body).toMatchObject({ decision: 'suspend', approved_scopes: [], note: 'Misused timetable data.' });
});
