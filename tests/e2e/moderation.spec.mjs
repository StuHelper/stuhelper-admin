import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';

const catalogue = (info) =>
  JSON.parse(
    fs.readFileSync(
      `apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`,
      'utf8',
    ),
  );
const base = 'http://127.0.0.1:18786';

const makeEntry = (id, overrides = {}) => ({
  id,
  root_id: id,
  school_id: 'school',
  input: {
    kind: 'course',
    target_id: 'course-1',
    term_id: 'term-1',
    teacher_id: 'teacher-1',
    title: `Review ${id}`,
    body: 'Detailed course review body.',
    ratings: [4, 4, 3, 4, 5],
    signed: false,
  },
  author_handle: 'anon-1',
  anonymous: true,
  state: 'pending',
  revision: 2,
  created_at: '2026-11-15T00:00:00Z',
  published_at: null,
  featured: false,
  ...overrides,
});

const makeTask = (id, objectId) => ({
  id,
  school_id: 'school',
  content_kind: 'review',
  submission: {
    object_id: objectId,
    kind: 'report',
    reason: 'Spam link in body',
    evidence: [],
  },
  object_revision: 2,
  revision: 3,
  state: 'waiting',
  created_at: '2026-11-15T00:00:00Z',
  updated_at: '2026-11-15T01:00:00Z',
});

const schoolObj = {
  id: 'school',
  kind: 'school',
  school_id: 'school',
  name: 'Demo University',
  credits: null,
  aliases: [],
  revision: 1,
  updated_at: '2026-11-01T00:00:00Z',
};

function mockCatalogSchool(page) {
  return page.route('**/api/v1/catalog/objects**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/lookup')) {
      return route.fulfill({ json: { items: [], missing_ids: [] } });
    }
    return route.fulfill({ json: { items: [schoolObj], next: '' } });
  });
}

test('queue batch preview applies decisions per item and content view handles unpublished entries', async ({
  page,
}, info) => {
  await schoolSession(page);
  await mockCatalogSchool(page);
  const all = catalogue(info);
  const m = all.moderation;
  const writes = [];
  let applied = false;
  await page.route('**/api/v1/moderation/tasks**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname.endsWith('/batch-preview')) {
      const body = req.postDataJSON();
      writes.push({
        kind: 'preview',
        body,
        key: req.headers()['idempotency-key'],
      });
      return route.fulfill({
        json: {
          preview_token: 'tok-batch-1',
          items: body.items.map((item) => ({
            id: item.id,
            state: 'decided',
            code: '',
          })),
        },
      });
    }
    if (u.pathname.endsWith('/batch')) {
      const body = req.postDataJSON();
      writes.push({
        kind: 'apply',
        body,
        key: req.headers()['idempotency-key'],
      });
      applied = true;
      return route.fulfill({
        json: {
          preview_token: body.preview_token,
          items: body.items.map((item) => ({
            id: item.id,
            state: 'applied',
            code: '',
          })),
        },
      });
    }
    if (req.method() === 'POST' && u.pathname.endsWith('/decisions')) {
      const body = req.postDataJSON();
      writes.push({
        kind: 'decision',
        body,
        key: req.headers()['idempotency-key'],
      });
      return route.fulfill({
        json: {
          ...makeTask('task-direct', 'entry-1'),
          state: 'applied',
          revision: 4,
          decision: body.decision,
        },
      });
    }
    if (u.searchParams.get('object_id')) {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({
      json: applied ? [] : [makeTask('t-1', 'entry-1')],
    });
  });
  await page.route('**/api/v1/reviews/admin/entries**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/history')) {
      return route.fulfill({ json: [makeEntry('entry-1')] });
    }
    if (u.pathname.endsWith('/entry-1')) {
      return route.fulfill({ json: makeEntry('entry-1') });
    }
    return route.fulfill({
      json: { items: [makeEntry('entry-1')], next: '' },
    });
  });

  await page.goto(`${base}/moderation/queue?lang=${info.project.metadata.locale}`);
  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr',
  );
  await page
    .getByRole('row')
    .filter({ hasText: 'Spam link in body' })
    .getByRole('checkbox')
    .check();
  await page.locator('#moderationview-field-6').fill('Confirmed spam');
  await page
    .getByRole('button', { name: m.previewBatch, exact: true })
    .click();
  await expect(page.getByText('t-1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.applyBatch, exact: true }).click();
  expect(writes.find((w) => w.kind === 'apply')?.body.preview_token).toBe(
    'tok-batch-1',
  );

  // Content view renders unpublished entry (published_at: null) as notProvided, never 1970.
  await page.goto(
    `${base}/moderation/content?lang=${info.project.metadata.locale}`,
  );
  const row = page.getByRole('row').filter({ hasText: 'Review entry-1' });
  await expect(
    row.getByText(all.common.notProvided, { exact: true }),
  ).toBeVisible();
  await expect(row).not.toContainText('1970');
});

test('moderation policy saves with revision and presentation keeps drafts across rating languages and retries with the original key', async ({
  page,
}, info) => {
  await schoolSession(page);
  await mockCatalogSchool(page);
  const all = catalogue(info);
  const m = all.moderation;
  const policyWrites = [];
  const presentationWrites = [];
  let failOnce = true;

  await page.route('**/api/v1/moderation/policies**', (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({
        json: {
          configured: {
            school_id: 'school',
            kind: 'course',
            mode: 'published',
            blocked_terms: ['spam'],
            revision: 4,
          },
          effective: {
            school_id: 'school',
            kind: 'course',
            mode: 'published',
            blocked_terms: ['spam'],
            revision: 4,
          },
          source: 'school',
        },
      });
    }
    const body = req.postDataJSON();
    policyWrites.push({ body, key: req.headers()['idempotency-key'] });
    return route.fulfill({ json: { ok: true } });
  });

  await page.route('**/api/v1/reviews/admin/presentation**', (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({
        json: {
          configured: null,
          effective: {
            school_id: 'school',
            revision: 0,
            rating_texts: {},
          },
          source: 'default',
        },
      });
    }
    const body = req.postDataJSON();
    presentationWrites.push({ body, key: req.headers()['idempotency-key'] });
    if (failOnce) {
      failOnce = false;
      return route.fulfill({
        status: 504,
        json: { code: 'timeout', request_id: 'req-p1' },
      });
    }
    const saved = { ...body, revision: 1 };
    return route.fulfill({
      json: { configured: saved, effective: saved, source: 'school' },
    });
  });

  await page.goto(
    `${base}/moderation/policies?lang=${info.project.metadata.locale}`,
  );
  await page.locator('#policyview-field-2').fill('spam\ncheat');
  await page
    .getByRole('button', { name: all.common.save, exact: true })
    .click();
  await expect(page.getByText(all.common.saved, { exact: true })).toBeVisible();
  expect(policyWrites[0].body).toEqual({
    school_id: 'school',
    kind: 'course',
    mode: 'published',
    blocked_terms: ['spam', 'cheat'],
    revision: 4,
  });

  await page.goto(
    `${base}/moderation/presentation?lang=${info.project.metadata.locale}`,
  );
  const selectLanguage = async (code) => {
    await page
      .locator('.ant-form-item')
      .filter({ hasText: m.ratingLanguage })
      .locator('.ant-select-selector')
      .click();
    await page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .getByTitle(code, { exact: true })
      .click();
  };

  await selectLanguage('zh-CN');
  await page.locator('#presentation-zh-CN-0-1').fill('不推荐自定义');
  await selectLanguage('en-US');
  await page.locator('#presentation-en-US-0-1').fill('Custom level 1');
  await selectLanguage('zh-CN');
  await expect(page.locator('#presentation-zh-CN-0-1')).toHaveValue(
    '不推荐自定义',
  );

  await page
    .getByRole('button', { name: all.common.save, exact: true })
    .click();
  const retryButton = page.getByRole('button', {
    name: all.common.retryOriginal,
    exact: true,
  });
  await expect(retryButton).toBeVisible();
  await retryButton.click();
  await expect(page.getByText(all.common.saved, { exact: true })).toBeVisible();
  expect(presentationWrites).toHaveLength(2);
  expect(presentationWrites[0].key).toBeTruthy();
  expect(presentationWrites[1].key).toBe(presentationWrites[0].key);
  expect(presentationWrites[1].body.rating_texts['zh-CN'][0][1]).toBe(
    '不推荐自定义',
  );
  expect(presentationWrites[1].body.rating_texts['en-US'][0][1]).toBe(
    'Custom level 1',
  );
});
