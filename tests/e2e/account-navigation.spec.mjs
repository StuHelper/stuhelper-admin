import { Buffer } from 'node:buffer';
import fs from 'node:fs';

import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) =>
  JSON.parse(
    fs.readFileSync(
      `apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`,
      'utf8',
    ),
  );
const base = 'http://127.0.0.1:18786';
const issuer = 'https://id.example.invalid';
const subject = 'user-7';
const principalKey = `${Buffer.from(issuer).toString('base64url')}:${Buffer.from(subject).toString('base64url')}`;

async function fits(page, info) {
  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('lookup jumps to billing in memory without URL query params and remembers the recent issuer', async ({
  page,
}, info) => {
  const all = catalogue(info);
  const accountReads = [];
  await page.route('**/api/v1/information-query/**', (route) =>
    route.fulfill({
      json: {
        groups: [
          {
            candidate: {
              account: `${issuer}|${subject}`,
              source: 'verification',
              current: true,
              changed_at: '2026-10-01T00:00:00Z',
              scope: { school: 'school-1', group: '*', module: '*' },
              label: [
                {
                  name: 'name',
                  category: 'identity',
                  value: '张*',
                  masked: true,
                },
              ],
            },
            items: [],
          },
        ],
        next_cursor: '',
        unavailable_domains: [],
      },
    }),
  );
  await page.route('**/api/v1/billing/admin/accounts**', (route) => {
    accountReads.push(new URL(route.request().url()).search);
    return route.fulfill({
      json: {
        target: { issuer, subject },
        wallet: {
          points: 100,
          ivory_minor: 0,
          frozen_ivory_minor: 0,
          debt_points: 0,
          frozen: false,
        },
        orders: { items: [], next: '' },
        ledger: { items: [], next: '' },
      },
    });
  });

  await page.goto(`${base}/system/lookup?lang=${info.project.metadata.locale}`);
  await page.getByLabel(all.lookup.value, { exact: true }).fill('张三');
  await page.getByLabel(all.lookup.purpose, { exact: true }).fill('Ticket 301');
  await page.getByRole('button', { name: all.lookup.submit, exact: true }).click();

  await page
    .getByRole('button', { name: all.accountJump.toBilling, exact: true })
    .click();
  await expect(page).toHaveURL(`${base}/billing/accounts`);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.locator('#billing-issuer')).toHaveValue(issuer);
  await expect(page.locator('#billing-subject')).toHaveValue(subject);
  // Prefill does not trigger an audited account read before confirmation.
  expect(accountReads).toEqual([]);

  await page.getByRole('button', { name: all.common.search, exact: true }).click();
  await expect.poll(() => accountReads.length).toBe(1);

  // Navigating away and returning defaults the issuer from session memory.
  await page.goBack();
  await expect(page).toHaveURL(/\/system\/lookup/);
  await page.goForward();
  await expect(page).toHaveURL(`${base}/billing/accounts`);
  await expect(page.locator('#billing-issuer')).toHaveValue(issuer);
  await expect(page.locator('#billing-subject')).toHaveValue('');
  await fits(page, info);
});

test('refund details jump to QQ binding, roles and session logout according to enabled capabilities', async ({
  page,
}, info) => {
  const all = catalogue(info);
  await page.route('**/api/v1/billing/admin/refunds**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'r-1',
            kind: 'refund',
            state: 'submitted',
            amount_minor: 2000,
            points: 0,
            reference: 'ref-1',
            channel: 'alipay',
            reason: 'Duplicate',
            created_at: '2026-11-01T00:00:00Z',
            allocations: [],
            original_points: 0,
            original_amount_minor: 2000,
            receipt_reference: '',
            failure_code: '',
            target: { issuer, subject },
          },
        ],
        next: '',
      },
    }),
  );
  await page.route('**/api/v1/platform/admin/role-templates', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/api/v1/admin/session-policy', (route) =>
    route.fulfill({
      json: { interval_minutes: 30, grace_minutes: 30, version: 1 },
    }),
  );

  await page.goto(`${base}/billing/refunds?lang=${info.project.metadata.locale}`);
  await page
    .getByRole('button', { name: all.billing.refunds.handle, exact: true })
    .click();
  const drawer = page.locator('.ant-drawer-content');
  await drawer
    .getByRole('button', { name: all.accountJump.toQqBinding, exact: true })
    .click();
  await expect(page).toHaveURL(`${base}/qq-binding`);
  await expect(page.locator('#qq-binding-owner')).toHaveValue(principalKey);

  // Disable qq-binding capability: QQ binding jump button hides, session jump still works.
  await page.route('**/api/v1/system/capabilities', (route) =>
    route.fulfill({
      json: {
        api_version: 1,
        capabilities: ['billing.manage', 'billing.commerce', 'information-query.query'],
      },
    }),
  );
  await page.goto(`${base}/billing/refunds?lang=${info.project.metadata.locale}`);
  await page
    .getByRole('button', { name: all.billing.refunds.handle, exact: true })
    .click();
  await expect(
    drawer.getByRole('button', { name: all.accountJump.toQqBinding, exact: true }),
  ).toHaveCount(0);
  await drawer
    .getByRole('button', { name: all.accountJump.toSessions, exact: true })
    .click();
  await expect(page).toHaveURL(`${base}/system/sessions`);
  await expect(page.locator('#session-subject')).toHaveValue(subject);
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await fits(page, info);
});
