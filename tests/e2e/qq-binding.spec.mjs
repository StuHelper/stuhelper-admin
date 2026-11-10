import fs from 'node:fs';

import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8'));
function fill(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) out = out.replaceAll(`{${key}}`, value);
  return out;
}
const base = 'http://127.0.0.1:18786';
const owner = 'aXNzdWVy:c3ViamVjdA';

// QQ binding administration following the contract: masked number, per-part revisions.
async function server(page) {
  const state = { status: { complete: true, onebot: { bound: true, revision: 2 }, connect: { bound: true, revision: 1 }, official: { bound: true, revision: 4 }, qq_number: '28******56' }, reads: [], releases: [] };
  await page.route('**/api/v1/qq-binding/admin/accounts/**', async (route) => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (request.method() === 'GET') {
      state.reads.push(path);
      return path.endsWith(owner) ? route.fulfill({ json: state.status }) : route.fulfill({ status: 404, json: { code: 'qq_binding_not_found' } });
    }
    const body = request.postDataJSON();
    state.releases.push({ path, body, key: request.headers()['idempotency-key'] });
    if (body.revision !== state.status[body.kind].revision) return route.fulfill({ status: 409, json: { code: 'qq_binding_revision_conflict' } });
    state.status = { ...state.status, complete: false, qq_number: body.kind === 'onebot' ? '' : state.status.qq_number, [body.kind]: { bound: false, revision: body.revision + 1 } };
    return route.fulfill({ json: state.status });
  });
  return state;
}

test('looking up an account shows the masked number and releasing one part keeps the others', async ({ page }, info) => {
  const all = catalogue(info); const q = all.qqBinding; const state = await server(page);
  await page.goto(`${base}/qq-binding?lang=${info.project.metadata.locale}`);
  await page.getByLabel(q.owner).fill('missing-account');
  await page.getByRole('button', { name: q.lookup, exact: true }).click();
  await expect(page.getByText(all.errors.qq_binding_not_found, { exact: true })).toBeVisible();
  await page.getByLabel(q.owner).fill(owner);
  await page.getByRole('button', { name: q.lookup, exact: true }).click();
  await expect(page.getByText(q.complete, { exact: true })).toBeVisible();
  await expect(page.getByText(fill(q.number, { number: '28******56' }), { exact: true })).toBeVisible();
  await page.getByRole('listitem').filter({ hasText: q.parts.connect }).getByRole('button', { name: q.release, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: q.confirmRelease, exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(q.reason).fill('Bound to the wrong account.');
  await confirm.click();
  await expect(page.getByText(fill(q.released, { part: q.parts.connect }), { exact: true })).toBeVisible();
  await expect(page.getByText(q.incomplete, { exact: true })).toBeVisible();
  expect(state.releases).toEqual([{ path: `/api/v1/qq-binding/admin/accounts/${owner}/release`, body: { kind: 'connect', revision: 1, reason: 'Bound to the wrong account.' }, key: expect.any(String) }]);
  await expect(page.getByRole('listitem').filter({ hasText: q.parts.onebot }).getByText(q.bound, { exact: true })).toBeVisible();
});
