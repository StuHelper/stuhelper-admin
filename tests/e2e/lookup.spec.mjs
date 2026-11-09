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
const record = (id, source, fields, current = true) => ({ id, subject: 'user-7', scope: { school: 'school-1', group: '*', module: '*' }, source, current, changed_at: '2026-11-01T02:00:00Z', fields });

// Information query server following the information-query contract.
async function server(page, options = {}) {
  const state = { queries: [], audits: [] };
  await page.route('**/api/v1/information-query/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    if (path.endsWith('/audit/query')) {
      state.audits.push(body);
      if (options.auditStatus) return route.fulfill({ status: options.auditStatus, json: { code: options.auditStatus === 403 ? 'forbidden' : 'unavailable' } });
      return route.fulfill({ json: { items: options.audits ?? [], next_cursor: '' } });
    }
    state.queries.push(body);
    if (options.queryStatus) return route.fulfill({ status: options.queryStatus, json: { code: options.queryStatus === 403 ? 'forbidden' : 'unavailable' } });
    const pages = options.pages ?? [{ items: [], next_cursor: '', unavailable_domains: [] }];
    return route.fulfill({ json: pages[Math.min(state.queries.length - 1, pages.length - 1)] });
  });
  return state;
}

const candidate = (account, extra = {}) => ({ account, source: 'verification', current: true, changed_at: '2026-10-01T00:00:00Z', scope: { school: 'school-1', group: '*', module: '*' }, label: [{ name: 'name', category: 'identity', value: '张*', masked: true }], ...extra });

test('a lookup states its purpose, groups records by candidate and continues a candidate on the next page', async ({ page }, info) => {
  const all = catalogue(info); const l = all.lookup;
  const person = candidate('https://id.example|user-7');
  const first = { groups: [{ candidate: person, items: [record('p1', 'profiles', [{ name: 'phone', category: 'identity', value: '138****2046', masked: true }])] }], next_cursor: 'c1', unavailable_domains: ['groups'] };
  const second = { groups: [{ candidate: person, items: [record('r1', 'reviews', [{ name: 'count', category: 'business', value: '12', masked: false }], false)] }], next_cursor: '', unavailable_domains: ['groups'] };
  const state = await server(page, { pages: [first, second] });
  await page.goto(`${base}/system/lookup?lang=${info.project.metadata.locale}`);
  const submit = page.getByRole('button', { name: l.submit, exact: true });
  await page.getByLabel(l.value, { exact: true }).fill('张三');
  await expect(submit).toBeDisabled();
  await page.getByLabel(l.purpose, { exact: true }).fill('Ticket 2041');
  await page.getByRole('checkbox', { name: l.domainNames.billing, exact: true }).uncheck();
  await page.getByRole('checkbox', { name: l.categories.identity, exact: true }).check();
  await submit.click();
  await expect(page.getByText('138****2046')).toBeVisible();
  await expect(page.getByText(fill(l.linkedBy, { source: l.sources.verification }), { exact: false })).toBeVisible();
  await expect(page.getByText(fill(l.incomplete, { domains: l.domainNames.groups }), { exact: true })).toBeVisible();
  expect(state.queries[0]).toEqual({ kind: 'name', value: '张三', scope: any, domains: ['profiles', 'verification', 'catalog', 'reviews', 'resources', 'groups'], fields: ['identity'], purpose: 'Ticket 2041', limit: 50 });

  await page.getByRole('button', { name: all.common.loadMore, exact: true }).click();
  await expect(page.getByText(l.historical, { exact: true })).toBeVisible();
  // The second page continues the same person, so one candidate holds both records.
  await expect(page.getByText(l.candidate, { exact: true })).toHaveCount(1);
  expect(state.queries[1]).toEqual({ ...state.queries[0], after: 'c1' });
  await expect(page.getByRole('button', { name: all.common.loadMore, exact: true })).toHaveCount(0);
});

test('people with the same name stay separate and a past QQ binding is marked historical', async ({ page }, info) => {
  const l = catalogue(info).lookup;
  const pages = [{ groups: [
    { candidate: candidate('https://id.example|user-7', { source: 'onebot', label: [] }), items: [] },
    { candidate: candidate('https://id.example|user-9', { source: 'onebot', current: false, label: [] }), items: [] },
  ], next_cursor: '', unavailable_domains: [] }];
  const state = await server(page, { pages });
  await page.goto(`${base}/system/lookup?lang=${info.project.metadata.locale}`);
  await page.locator('.ant-form-item').filter({ hasText: l.kind }).locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle(l.kinds.qq, { exact: true }).click();
  await page.getByLabel(l.value, { exact: true }).fill('12345678');
  await page.getByLabel(l.purpose, { exact: true }).fill('Report 88');
  await page.getByRole('button', { name: l.submit, exact: true }).click();
  const results = page.getByRole('list', { name: l.results });
  await expect(results.getByText(l.candidate, { exact: true })).toHaveCount(2);
  await expect(results.getByText(l.historical, { exact: true })).toHaveCount(1);
  await expect(results.getByText(l.noRecords, { exact: true })).toHaveCount(2);
  expect(state.queries[0].kind).toBe('qq');
});

test('a refused lookup shows the reason and keeps nothing on screen', async ({ page }, info) => {
  const all = catalogue(info); const l = all.lookup;
  await server(page, { queryStatus: 403 });
  await page.goto(`${base}/system/lookup?lang=${info.project.metadata.locale}`);
  await page.getByLabel(l.value, { exact: true }).fill('10001');
  await page.getByLabel(l.purpose, { exact: true }).fill('Appeal 7');
  await page.getByRole('button', { name: l.submit, exact: true }).click();
  await expect(page.getByText(all.errors.forbidden, { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: l.results })).toHaveCount(0);
});

test('the query log needs a purpose and lists what each query returned', async ({ page }, info) => {
  const all = catalogue(info); const l = all.lookup;
  const entry = { id: '9', actor: 'admin-1', request_id: 'req-1', purpose: 'Ticket 2041', scope: any, channel: 'web', target_group: '', action: 'query', result: 'success', count: 3, targets: ['user-7'], fields: ['identity'], basis: [], created_at: '2026-11-08T01:00:00Z' };
  const state = await server(page, { audits: [entry] });
  await page.goto(`${base}/system/lookup?lang=${info.project.metadata.locale}`);
  await page.getByRole('tab', { name: l.auditTab }).click();
  const search = page.getByRole('button', { name: all.common.search, exact: true });
  await expect(search).toBeDisabled();
  await page.locator('#lookup-audit-purpose').fill('Monthly check');
  await search.click();
  await expect(page.getByText('admin-1')).toBeVisible();
  await expect(page.getByText(fill(l.auditCount, { count: new Intl.NumberFormat(info.project.metadata.locale).format(3) }), { exact: true })).toBeVisible();
  expect(state.audits[0]).toEqual({ scope: any, purpose: 'Monthly check', after: '', limit: 50 });
});
