import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';

const origin = 'http://127.0.0.1:18786';
const owner = 'owner:' + 'a'.repeat(64);
const target = '**/api/v1/storage/contribution-admission-policy';
const text = ({ project }) => JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${project.metadata.locale}/page.json`, 'utf8'));

test('edits account and group admissions and retries the original revision', async ({ page }, info) => {
  const labels = text(info);
  await schoolSession(page);
  await page.route('**/api/v1/system/capabilities', route => route.fulfill({
    json: { api_version: 1, capabilities: ['storage.admissions'] },
  }));
  const saves = [];
  let policy = {
    revision: 1,
    memberships: [{ owner_domain: owner, role_ids: ['reviewers'], group_ids: ['campus-storage'] }],
    rules: [{ subject_kind: 'group', subject_id: 'campus-storage', instance_id: 'instance-one', levels: ['public', 'quarantine'] }],
  };
  await page.route(target, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: policy });
    const body = request.postDataJSON();
    saves.push({ body, key: request.headers()['idempotency-key'] });
    if (saves.length === 1) {
      policy = { ...body, revision: 2 };
      return route.abort('failed');
    }
    return route.fulfill({ json: policy });
  });

  await page.goto(`${origin}/storage/admissions?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('heading', { name: labels.admissions.title })).toBeVisible();
  await expect(page.getByText(labels.admissions.quarantine, { exact: true })).toBeVisible();
  await page.getByLabel(labels.admissions.instance, { exact: true }).fill('instance-two');
  await page.getByRole('button', { name: labels.common.save, exact: true }).click();
  await expect(page.getByRole('button', { name: labels.common.retryOriginal, exact: true })).toBeVisible();
  await page.getByRole('button', { name: labels.common.retryOriginal, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(labels.common.saved);
  expect(saves).toHaveLength(2);
  expect(saves[1]).toEqual(saves[0]);
  expect(saves[0].body).toMatchObject({
    revision: 1,
    rules: [{ subject_kind: 'group', subject_id: 'campus-storage', instance_id: 'instance-two', levels: ['public', 'quarantine'] }],
  });
  expect(saves[0].key).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ledger-only configuration loads rules without exposing commerce', async ({ page }, info) => {
  const labels = text(info);
  await schoolSession(page);
  await page.route('**/api/v1/system/capabilities', route => route.fulfill({
    json: { api_version: 1, capabilities: ['billing.manage', 'billing.ledger-only'] },
  }));
  const loads = [];
  await page.route('**/api/v1/billing/admin/**', route => {
    loads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { items: [], next: '' } });
  });
  await page.goto(`${origin}/billing/config?lang=${info.project.metadata.locale}`);
  await expect(page.getByText(labels.billing.ledgerOnly, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: labels.billing.config.newRule, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: labels.billing.config.newChannel, exact: true })).toHaveCount(0);
  expect(loads).toEqual(['/api/v1/billing/admin/rules']);
});
