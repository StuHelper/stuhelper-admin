import { Buffer } from 'node:buffer';
import fs from 'node:fs';

import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8'));
function fill(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) out = out.replaceAll(`{${key}}`, value);
  return out;
}
const list = (info, values) => new Intl.ListFormat(info.project.metadata.locale, { style: 'long', type: 'conjunction' }).format(values);
const base = 'http://127.0.0.1:18786';
const school = { id: 'school', name: 'Demo University', enabled: true, methods: ['manual_material_review'], notice_version: 'v1', opening_date: '2026-09-01', newcomer_days: 30, email_domain: 'demo.edu', material_types: ['staff_card'], revision: 1 };
const application = { id: 'ta', school_id: 'school', method: 'manual_material_review', stage: 'unknown', kind: 'teacher', state: 'pending_review', revision: 5, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', credential_id: '', result_code: '' };
const form = { name: 'Lin Wei', organization: 'School of Computing', email: 'lin@demo.edu', material_type: 'staff_card', material_ids: ['m1'], disclosures: ['teacher'], revision: 5 };
const teacher = (id, name) => ({ id, kind: 'teacher', name, school_id: 'school', credits: null, aliases: [], revision: 1, updated_at: '2026-10-27T00:00:00Z' });
const credential = { id: 'tc', school_id: 'school', teacher_ids: ['p1'], state: 'active', revision: 2, verified_at: '2026-11-01T00:00:00Z', expires_at: null, source: 'manual_material_review', note: '', disclosures: ['teacher', 'organization'] };
// One transparent PNG pixel as the photographed evidence.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// Verification and catalog servers following the contracts. Writes are recorded with their idempotency keys.
async function server(page) {
  const state = { writes: [], searches: [] };
  await page.route('**/api/v1/catalog/objects**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/lookup')) return route.fulfill({ json: { items: [teacher('p1', 'Prof. Lin')], missing_ids: [] } });
    state.searches.push(Object.fromEntries(url.searchParams));
    const q = url.searchParams.get('q') ?? '';
    const items = [teacher('p1', 'Prof. Lin'), teacher('p2', 'Dr. Zhao')].filter((item) => !q || item.name.includes(q) || q === 'Lin Wei');
    return route.fulfill({ json: { items, next: '' } });
  });
  await page.route('**/api/v1/**verification/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path === '/api/v1/admin/verification/access') return route.fulfill({ json: { allowed: true } });
      if (path === '/api/v1/verification/schools') return route.fulfill({ json: [school] });
      if (path === '/api/v1/admin/verification/schools/school/teacher-applications') return route.fulfill({ json: state.reviewed ? [] : [application] });
      if (path === '/api/v1/admin/verification/applications/ta/teacher-form') return route.fulfill({ json: form });
      if (path === '/api/v1/verification/materials/m1') return route.fulfill({ body: pixel, contentType: 'image/png' });
      if (path === '/api/v1/admin/verification/teacher-credentials/tc') return route.fulfill({ json: credential });
      return route.fulfill({ status: 404, json: { code: 'not_found' } });
    }
    const body = request.postDataJSON();
    state.writes.push({ path, body, key: request.headers()['idempotency-key'] });
    if (path.endsWith('/teacher-review')) {
      state.reviewed = true;
      return route.fulfill({ json: { ...application, state: body.decision === 'approve' ? 'approved' : 'rejected', revision: 6 } });
    }
    if (path.endsWith('/revoke')) return route.fulfill({ json: { ...credential, state: 'revoked', revision: 3, note: body.note } });
    return route.fulfill({ status: 404, json: { code: 'not_found' } });
  });
  return state;
}

test('approving a teacher application binds the chosen catalog teacher profiles', async ({ page }, info) => {
  const all = catalogue(info); const v = all.teacherVerification; const state = await server(page);
  await page.goto(`${base}/verification/teachers?lang=${info.project.metadata.locale}`);
  await page.getByRole('row').filter({ hasText: all.verification.states.pending_review }).getByRole('button', { name: all.verification.review, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByText('School of Computing', { exact: true })).toBeVisible();
  await expect(drawer.getByText(v.disclosure.teacher, { exact: true })).toBeVisible();
  await expect(drawer.getByRole('img', { name: fill(all.verification.material, { index: '1' }) })).toBeVisible();
  // The search starts with the applicant's name in the applicant's school.
  expect(state.searches[0]).toMatchObject({ kind: 'teacher', school_id: 'school', q: 'Lin Wei' });
  const approve = drawer.getByRole('button', { name: all.verification.approve, exact: true });
  await expect(approve).toBeDisabled();
  await expect(drawer.getByRole('button', { name: all.verification.reject, exact: true })).toBeDisabled();
  await drawer.locator('.ant-form-item').filter({ hasText: v.profiles }).locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle('Prof. Lin').click();
  await drawer.getByText(v.profilesHint, { exact: true }).click();
  await approve.click();
  await expect(page.getByText(v.done.approve, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ path: '/api/v1/admin/verification/applications/ta/teacher-review', key: expect.any(String), body: { decision: 'approve', note: '', revision: 5, teacher_ids: ['p1'], expires_at: null } }]);
  await expect(page.getByText(v.empty, { exact: true })).toBeVisible();
});

test('returning an application for more materials requires a note and binds nothing', async ({ page }, info) => {
  const all = catalogue(info); const v = all.teacherVerification; const state = await server(page);
  await page.goto(`${base}/verification/teachers?lang=${info.project.metadata.locale}`);
  await page.getByRole('button', { name: all.verification.review, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  const supplement = drawer.getByRole('button', { name: all.verification.supplement, exact: true });
  await expect(supplement).toBeDisabled();
  await drawer.getByLabel(all.verification.note).fill('The staff card photo is blurry.');
  await supplement.click();
  await expect(page.getByText(v.done.supplement, { exact: true })).toBeVisible();
  expect(state.writes.map((item) => item.body)).toEqual([{ decision: 'supplement', note: 'The staff card photo is blurry.', revision: 5, teacher_ids: [] }]);
});

test('a teacher qualification is looked up and revoked with a reason', async ({ page }, info) => {
  const all = catalogue(info); const v = all.teacherVerification; const state = await server(page);
  await page.goto(`${base}/verification/teachers?lang=${info.project.metadata.locale}`);
  await page.getByRole('tab', { name: v.tabs.credentials, exact: true }).click();
  await page.getByLabel(v.credentialId).fill('tc');
  await page.getByRole('button', { name: all.common.search, exact: true }).click();
  await expect(page.getByText('Prof. Lin', { exact: true })).toBeVisible();
  await expect(page.getByText(list(info, [v.disclosure.teacher, v.disclosure.organization]), { exact: true })).toBeVisible();
  const revoke = page.getByRole('button', { name: all.verification.revoke, exact: true });
  await expect(revoke).toBeDisabled();
  await page.getByLabel(all.common.reason).fill('Left the school.');
  await revoke.click();
  await expect(page.getByText(v.revoked, { exact: true })).toBeVisible();
  await expect(page.getByText(all.verification.states.revoked, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ path: '/api/v1/admin/verification/teacher-credentials/tc/revoke', key: expect.any(String), body: { approve: true, note: 'Left the school.', revision: 2 } }]);
});

test('school selection delegates codes names and aliases to the server', async ({ page }, info) => {
  const all = catalogue(info);
  await server(page);
  const queries = [];
  await page.route('**/api/v1/verification/schools?**', route => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q) queries.push(q);
    return route.fulfill({ json: q === '99999' ? [] : [school] });
  });
  await page.goto(`${base}/verification/teachers?lang=${info.project.metadata.locale}`);
  const input = page.getByRole('combobox', { name: all.common.school });
  for (const q of ['4111010006', '10006', '北京航空航天大学', '北航', '99999']) {
    await input.fill(q);
    await expect.poll(() => queries.at(-1)).toBe(q);
    const option = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
    await expect(option).toHaveCount(q === '99999' ? 0 : 1);
    if (q !== '99999') await expect(option).toHaveText(school.name);
  }
});
