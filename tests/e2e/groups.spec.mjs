import fs from 'node:fs';

import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`, 'utf8'));
function fill(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) out = out.replaceAll(`{${key}}`, value);
  return out;
}
const base = 'http://127.0.0.1:18786';
const zero = '0001-01-01T00:00:00Z';
const config = { id: 'g1', school: 'school', name: 'Algorithms Q&A', number: '****4821', bot_enabled: true, revision: 3, password_set: false, mode: 'before', require_student: true, accept_alumni: false, accept_temporary: true, grace_seconds: 72 * 3600, reminder_seconds: 24 * 3600, retention_seconds: 7 * 86_400, card_template: '{name}', auto_card: false, dice_sides: 6, mute_probability: 10, mute_seconds: 60, cooldown_seconds: 300, pity: 10, keywords: ['spam'], repeat_threshold: 5, auto_actions: ['warn'], welcome: 'Welcome', rules_template: 'Be kind', check_card: true, remind_card: true, block_links: false, frequency_seconds: 10, frequency_limit: 8, warning_limit: 3 };
const member = { owner: 'user-7', state: 'grace', deadline: '2026-11-12T00:00:00Z', reminder: zero, password: false, exempt: false, extended: false, failures: 0, last_play: zero, muted_until: zero, id: 'user-7', joined: true };

// Groups server following the groups 0.3.0 contract; writes are recorded.
async function server(page, options = {}) {
  const state = { writes: [] };
  await page.route('**/api/v1/groups**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1/groups', '');
    if (request.method() !== 'GET') {
      const body = request.postDataJSON();
      state.writes.push({ method: request.method(), path, body, key: request.headers()['idempotency-key'] });
      if (path === '/g1' && (options.conflict || body.expected_revision !== config.revision)) return route.fulfill({ status: 409, json: { code: 'groups_conflict' } });
      if (path === '/g1') return route.fulfill({ json: { ...config, ...body, expected_revision: undefined, password: undefined, revision: 4 } });
      return route.fulfill({ json: { id: 'act-1', state: 'unknown', action: body.kind, value: 0, detail: '' } });
    }
    if (path === '') return route.fulfill({ json: { items: [{ id: 'g1', school: 'school', name: config.name, number: config.number, member_count: 412, bot_enabled: true, require_student: true, pending_count: 2, revision: 3 }], next_cursor: '' } });
    if (path === '/g1') return route.fulfill({ json: config });
    if (path === '/g1/members') return route.fulfill({ json: { items: [member], next_cursor: '' } });
    if (path === '/g1/actions') return route.fulfill({ json: { items: [{ id: 'a1', group: 'g1', actor: { issuer: 'https://id.example', subject: 'admin-1' }, capability: 'groups.manage', command: { kind: 'kick', target: 'user-9' }, state: 'unknown', result: '', created: '2026-11-08T00:00:00Z' }], next_cursor: '' } });
    return route.fulfill({ json: { items: [], next_cursor: '' } });
  });
  return state;
}

test('a member is muted from the group page with the duration in seconds', async ({ page }, info) => {
  const all = catalogue(info); const g = all.groups;
  const state = await server(page);
  await page.goto(`${base}/qq/groups?lang=${info.project.metadata.locale}`);
  await page.getByRole('link', { name: config.name, exact: true }).click();
  await expect(page.getByText(g.memberStates.grace, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: g.manage, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle(g.commands.mute, { exact: true }).click();
  await dialog.getByLabel(g.minutes).fill('30');
  await dialog.getByRole('button', { name: g.send, exact: true }).click();
  await expect(dialog.getByText(fill(g.commandSent, { state: g.states.unknown }), { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ method: 'POST', path: '/g1/commands', key: expect.any(String), body: { kind: 'mute', target: 'user-7', seconds: 1800 } }]);
});

test('a warning cannot be sent without a reason', async ({ page }, info) => {
  const all = catalogue(info); const g = all.groups;
  const state = await server(page);
  await page.goto(`${base}/qq/groups/g1?lang=${info.project.metadata.locale}`);
  await page.getByRole('button', { name: g.manage, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle(g.commands.warn, { exact: true }).click();
  const send = dialog.getByRole('button', { name: g.send, exact: true });
  await expect(send).toBeDisabled();
  await dialog.getByLabel(g.reason).fill('Advertising');
  await send.click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body).toEqual({ kind: 'warn', target: 'user-7', text: 'Advertising' });
});

test('bot actions awaiting confirmation are labelled and explained', async ({ page }, info) => {
  const g = catalogue(info).groups;
  await server(page);
  await page.goto(`${base}/qq/groups/g1?lang=${info.project.metadata.locale}`);
  await page.getByRole('tab', { name: g.tabs.actions, exact: true }).click();
  await expect(page.getByText(g.unknownHint, { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: g.states.unknown, exact: true })).toBeVisible();
});

test('group settings save hours as seconds with the starting revision, and a conflict offers a reload', async ({ page }, info) => {
  const all = catalogue(info); const g = all.groups;
  const state = await server(page);
  await page.goto(`${base}/qq/groups/g1?lang=${info.project.metadata.locale}`);
  await page.getByRole('link', { name: g.tabs.config }).click();
  await page.getByLabel(g.config.graceHours).fill('48');
  await page.getByRole('button', { name: all.common.save, exact: true }).click();
  await expect(page.getByText(g.config.saved, { exact: true })).toBeVisible();
  const { id, school, number, password_set: _set, revision, ...rest } = config;
  expect(state.writes[0]).toEqual({ method: 'PUT', path: '/g1', key: expect.any(String), body: { ...rest, id, school, grace_seconds: 48 * 3600, expected_revision: revision } });
});

test('a concurrent change to group settings keeps the draft', async ({ page }, info) => {
  const all = catalogue(info); const g = all.groups;
  await server(page, { conflict: true });
  await page.goto(`${base}/qq/groups/g1?lang=${info.project.metadata.locale}`);
  await page.getByRole('link', { name: g.tabs.config }).click();
  await page.getByLabel(g.config.welcome).fill('Hello again');
  await page.getByRole('button', { name: all.common.save, exact: true }).click();
  await page.getByRole('button', { name: all.common.reloadCompare, exact: true }).click();
  await expect(page.getByLabel(g.config.welcome)).toHaveValue('Hello again');
});
