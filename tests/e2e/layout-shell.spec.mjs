import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';

const base = 'http://127.0.0.1:18786';
const policy = JSON.parse(fs.readFileSync('locale-policy.json', 'utf8'));
const pageCatalogue = (locale) =>
  JSON.parse(
    fs.readFileSync(`apps/web-antd/src/locales/langs/${locale}/page.json`, 'utf8'),
  );
const prefsCatalogue = (locale) =>
  JSON.parse(
    fs.readFileSync(
      `packages/locales/src/langs/${locale}/preferences.json`,
      'utf8',
    ),
  );

const feedbackFixture = () => ({
  id: 'case-shell',
  sender: 'student@example.test',
  subject: 'Shell language switch check',
  body: 'Please help check my reply.',
  authentication_results: 'example.test; spf=pass',
  suspicious: false,
  state: 'new',
  assignee: '',
  note: '',
  revision: 1,
  received_at: '2026-11-15T00:00:00Z',
  closed_at: null,
  attachments: [],
  replies: [],
});

test('switching language preserves pending writes, original idempotency key, RTL direction and bundled header controls', async ({
  page,
}, info) => {
  await schoolSession(page);
  await page.route('**/api/v1/system/capabilities', (route) =>
    route.fulfill({ json: { api_version: 1, capabilities: ['moderation.tasks'] } }),
  );

  const iconifyRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('iconify')) iconifyRequests.push(request.url());
  });

  const message = feedbackFixture();
  const replyKeys = [];
  let outage = true;
  await page.route('**/api/v1/moderation/feedback**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/replies')) {
      replyKeys.push(request.headers()['idempotency-key']);
      if (outage) {
        outage = false;
        return route.fulfill({ status: 503, json: { code: 'unavailable' } });
      }
      const reply = {
        id: 'reply-shell',
        body: request.postDataJSON().body,
        actor: 'operator',
        state: 'unknown',
        created_at: '2026-11-15T01:00:00Z',
      };
      message.replies = [reply];
      return route.fulfill({ json: reply });
    }
    return route.fulfill({
      json: path.endsWith('/case-shell')
        ? message
        : { items: [message], next_cursor: '' },
    });
  });

  const startLocale = info.project.metadata.locale;
  const startText = pageCatalogue(startLocale).feedback;
  const startPrefs = prefsCatalogue(startLocale);

  await page.goto(`${base}/moderation/feedback?lang=${startLocale}`);

  // Header theme toggle is visible with a localized accessible label, and sidebar toggle has an accessible name.
  const themeToggle = page.locator('button.theme-toggle');
  await expect(themeToggle).toBeVisible();
  await expect(themeToggle).toHaveAttribute(
    'aria-label',
    new RegExp(`${startPrefs.theme.light}|${startPrefs.theme.dark}`),
  );
  const sidebarToggle = page.locator('header button[aria-label]').first();
  await expect(sidebarToggle).toBeVisible();

  await page.getByRole('button').filter({ hasText: 'Shell language switch check' }).click();
  await page.getByLabel(startText.note, { exact: true }).fill('Unsaved operator note');
  await page.getByLabel(startText.reply, { exact: true }).fill('Pending reply draft');
  await page.getByRole('button', { name: startText.send, exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  // Switch language via the header LanguageToggle: active view must stay mounted with its draft and idempotency key.
  const targetLocale = startLocale === 'ar-EG' ? 'zh-CN' : 'ar-EG';
  const targetLabel = policy.languages[targetLocale].name;
  const targetText = pageCatalogue(targetLocale).feedback;

  await page.getByRole('button', { name: startPrefs.language, exact: true }).click();
  await page.getByRole('menuitem', { name: targetLabel, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    targetLocale === 'ar-EG' ? 'rtl' : 'ltr',
  );

  // Draft note, reply input and pending retry remain intact without component unmount.
  await expect(page.getByLabel(targetText.note, { exact: true })).toHaveValue(
    'Unsaved operator note',
  );
  await expect(page.getByLabel(targetText.reply, { exact: true })).toHaveValue(
    'Pending reply draft',
  );
  await page.getByRole('button', { name: targetText.retry, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: targetText.unknown }),
  ).toBeVisible();
  expect(replyKeys).toHaveLength(2);
  expect(replyKeys[1]).toBe(replyKeys[0]);
  expect(iconifyRequests).toEqual([]);
});

test('disabled module routes set the unavailable document title instead of exposing disabled module names', async ({
  page,
}, info) => {
  await schoolSession(page);
  await page.route('**/api/v1/system/capabilities', (route) =>
    route.fulfill({ json: { api_version: 1, capabilities: [] } }),
  );
  const locale = info.project.metadata.locale;
  const unavailableTitle = pageCatalogue(locale).errors.disabled;
  await page.goto(`${base}/billing/refunds?lang=${locale}`);
  await expect(page.locator('.ant-result-info')).toBeVisible();
  await expect(page).toHaveTitle(`${unavailableTitle} - stuhelper-admin`);
});
