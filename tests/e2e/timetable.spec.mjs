import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8'));
const base = 'http://127.0.0.1:18786';
test.beforeEach(async ({ page }) => { await schoolSession(page); });
const object = (id, kind, name) => ({ id, kind, name, school_id: 'school', credits: null, aliases: [], revision: 1, updated_at: '2026-10-27T00:00:00Z' });
const stored = { school_id: 'school', term_id: 'fall', revision: 3, week_one_start: '2026-09-07', timezone: 'Asia/Shanghai', periods: [{ number: 1, start: '08:00', end: '08:45' }] };

// Catalog server: one school, two terms, and a timetable store with revision checks.
async function server(page, options = {}) {
  const state = { timetables: { fall: 'fall' in options ? options.fall : stored }, writes: [] };
  await page.route('**/api/v1/catalog/objects**', (route) => {
    const kind = new URL(route.request().url()).searchParams.get('kind');
    const items = kind === 'school' ? [object('school', 'school', 'Demo University')] : (kind === 'term' ? [object('spring', 'term', 'Spring'), object('fall', 'term', 'Fall')] : []);
    return route.fulfill({ json: { items, next: '' } });
  });
  await page.route('**/api/v1/catalog/admin/schools/school/terms/*/timetable', (route) => {
    const request = route.request();
    const term = new URL(request.url()).pathname.split('/').at(-2);
    if (request.method() === 'GET') {
      const value = state.timetables[term];
      return value ? route.fulfill({ json: value }) : route.fulfill({ status: 404, json: { code: 'not_found' } });
    }
    const body = request.postDataJSON();
    state.writes.push({ term, body, key: request.headers()['idempotency-key'] });
    const current = state.timetables[term]?.revision ?? 0;
    if (options.conflict || body.revision !== current) return route.fulfill({ status: 409, json: { code: 'conflict' } });
    state.timetables[term] = { ...body, revision: current + 1 };
    return route.fulfill({ json: state.timetables[term] });
  });
  return state;
}

test('editing a term timetable sends its revision and the numbered periods', async ({ page }, info) => {
  const all = catalogue(info); const tt = all.timetable;
  const state = await server(page);
  await page.goto(`${base}/catalog/timetable?lang=${info.project.metadata.locale}`);
  await expect(page.getByLabel(tt.startOf.replace('{number}', '1'))).toHaveValue('08:00');
  const save = page.getByRole('button', { name: all.common.save, exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: tt.add, exact: true }).click();
  await expect(page.getByLabel(tt.startOf.replace('{number}', '2'))).toHaveValue('08:55');
  await save.click();
  await expect(page.getByText(tt.saved, { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ term: 'fall', key: expect.any(String), body: { ...stored, periods: [{ number: 1, start: '08:00', end: '08:45' }, { number: 2, start: '08:55', end: '09:40' }] } }]);
  await expect(save).toBeDisabled();
});

test('a term without a timetable starts empty and explains what is wrong before saving', async ({ page }, info) => {
  const all = catalogue(info); const tt = all.timetable;
  const state = await server(page, { fall: null });
  await page.goto(`${base}/catalog/timetable?lang=${info.project.metadata.locale}`);
  await expect(page.getByText(tt.missing, { exact: true })).toBeVisible();
  await page.getByLabel(tt.weekOne).fill('2026-09-08');
  await page.getByRole('button', { name: tt.add, exact: true }).click();
  await expect(page.getByText(tt.problems.notMonday, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: all.common.save, exact: true })).toBeDisabled();
  await page.getByLabel(tt.weekOne).fill('2026-09-07');
  await page.getByRole('button', { name: all.common.save, exact: true }).click();
  await expect(page.getByText(tt.saved, { exact: true })).toBeVisible();
  expect(state.writes[0].body).toMatchObject({ term_id: 'fall', revision: 0, week_one_start: '2026-09-07', periods: [{ number: 1, start: '08:00', end: '08:45' }] });
});

test('a conflicting save keeps the draft and offers to reload the latest version', async ({ page }, info) => {
  const all = catalogue(info); const tt = all.timetable;
  await server(page, { conflict: true });
  await page.goto(`${base}/catalog/timetable?lang=${info.project.metadata.locale}`);
  await page.getByLabel(tt.endOf.replace('{number}', '1')).fill('08:50');
  await page.getByRole('button', { name: all.common.save, exact: true }).click();
  await expect(page.getByRole('button', { name: all.common.reloadCompare, exact: true })).toBeVisible();
  await page.getByRole('button', { name: all.common.reloadCompare, exact: true }).click();
  await expect(page.getByLabel(tt.endOf.replace('{number}', '1'))).toHaveValue('08:50');
});
