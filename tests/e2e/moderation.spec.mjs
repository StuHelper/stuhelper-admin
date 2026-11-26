import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';
import { queueSummary } from './resource-fixture.mjs';

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
    teacher_ids: ['teacher-1'],
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

test('moderation previews and applies multiple teachers from the review term', async ({ page }, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const task = makeTask('reviewux-task', 'entry-1');
  const entry = makeEntry('entry-1', { state: 'published' });
  let previewBody;
  let decisionBody;
  await page.route('**/api/v1/catalog/objects**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/lookup')) {
      return route.fulfill({ json: { items: [], missing_ids: [] } });
    }
    if (url.searchParams.get('kind') !== 'teacher') {
      return route.fulfill({ json: { items: [schoolObj], next: '' } });
    }
    expect(url.searchParams.get('course_id')).toBe('course-1');
    expect(url.searchParams.get('term_id')).toBe('term-1');
    const items = [1, 2].map((id) => ({
      ...schoolObj, id: `teacher-${id}`, kind: 'teacher', name: `Professor ${id}`,
    }));
    return route.fulfill({ json: { items, next: '' } });
  });
  await page.route('**/api/v1/reviews/admin/entries/**', (route) => {
    const request = route.request();
    if (request.url().includes('/attribution')) {
      previewBody = request.postDataJSON();
      return route.fulfill({ json: { revision: 2, evidence_revision: 'reviewux-evidence', teacher_ids: previewBody.teacher_ids, previous_teacher_ids: ['teacher-1'] } });
    }
    if (request.url().includes('/history')) return route.fulfill({ json: [] });
    return route.fulfill({ json: entry });
  });
  await page.route('**/api/v1/moderation/tasks**', (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith('/summary')) return route.fulfill({ json: queueSummary({ waiting: 1 }) });
    if (path.endsWith('/decisions')) {
      decisionBody = req.postDataJSON();
      return route.fulfill({ json: { ...task, state: 'applied', revision: 4, decision: decisionBody.decision } });
    }
    return route.fulfill({ json: path.endsWith('/tasks') ? [task] : task });
  });
  await page.goto(`${base}/moderation/queue?lang=${info.project.metadata.locale}`);
  await page.getByRole('button', { name: all.common.open, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByText('Professor 1', { exact: true })).toBeVisible();
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  await drawer.locator('#decisionpanel-field-1').click();
  await dropdown.getByText(all.moderation.actions.reassign, { exact: true }).click();
  await drawer.locator('#decisionpanel-field-2').click();
  await dropdown.getByText('Professor 2', { exact: true }).click();
  await drawer.locator('#decisionpanel-field-2').press('Escape');
  await drawer.getByRole('button', { name: all.moderation.previewAttribution, exact: true }).click();
  const attribution = all.moderation.attributionResult.replace('{teachers}', 'Professor 1, Professor 2');
  await expect(drawer.getByText(attribution, { exact: true })).toBeVisible();
  expect(previewBody).toEqual({ teacher_ids: ['teacher-1', 'teacher-2'] });
  await drawer.getByLabel(all.moderation.reason, { exact: true }).fill('Confirmed both teachers');
  await drawer.getByRole('button', { name: all.moderation.applyDecision, exact: true }).click();
  await expect.poll(() => decisionBody).toMatchObject({ decision: {
    action: 'reassign', evidence_revision: 'reviewux-evidence', teacher_ids: ['teacher-1', 'teacher-2'],
  } });
});

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
    if (u.pathname.endsWith('/summary')) {
      return route.fulfill({ json: queueSummary({ waiting: applied ? 0 : 1 }) });
    }
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
  const reason = page.locator('#moderationview-field-6');
  const previewButton = page.getByRole('button', {
    name: m.previewBatch,
    exact: true,
  });
  const acceptedReason = '😀'.repeat(2000);
  const rejectedReason = `${acceptedReason}😀`;
  await reason.fill(rejectedReason);
  await expect(reason).toHaveValue(rejectedReason);
  await expect(previewButton).toBeDisabled();
  expect(writes).toEqual([]);
  await reason.fill(acceptedReason);
  await previewButton.click();
  await expect(page.getByText('t-1', { exact: true })).toBeVisible();
  expect(writes.find((w) => w.kind === 'preview')?.body.items[0].decision.reason)
    .toBe(acceptedReason);
  await page.getByRole('button', { name: m.applyBatch, exact: true }).click();
  expect(writes.find((w) => w.kind === 'apply')?.body).toMatchObject({
    preview_token: 'tok-batch-1',
    items: [{ decision: { reason: acceptedReason } }],
  });

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

test('a moderator rejects the selected follow-up without deciding its sibling or the original review', async ({ page }, info) => {
  await schoolSession(page);
  await mockCatalogSchool(page);
  const messages = catalogue(info);
  const entry = makeEntry('post', {
    state: 'published',
    appends: ['first', 'second'].map(id => ({ id, body: `Follow-up ${id}`, state: 'published', review_requested: true, created_at: '2026-11-19T00:00:00Z' })),
  });
  const tasks = entry.appends.map(item => {
    const task = makeTask(`task-${item.id}`, entry.id);
    return { ...task, submission: { ...task.submission, append_id: item.id, kind: 'review', reason: `Review ${item.id}` } };
  });
  const decisions = [];
  await page.route('**/api/v1/moderation/tasks**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/summary')) {
      const waiting = tasks.filter((task) => task.state === 'waiting').length;
      return route.fulfill({ json: queueSummary({ waiting, reviews: waiting }) });
    }
    const task = tasks.find(row => path.includes(`/${row.id}`));
    if (task && path.endsWith('/decisions')) {
      const { decision } = request.postDataJSON();
      decisions.push(decision);
      task.state = 'applied';
      return route.fulfill({ json: { ...task, decision } });
    }
    return route.fulfill({ json: task ?? tasks });
  });
  await page.route('**/api/v1/reviews/admin/entries/post**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/history')) return route.fulfill({ json: [] });
    expect(url.searchParams.get('include_appends')).toBe('true');
    return route.fulfill({ json: entry });
  });
  await page.goto(`${base}/moderation/queue?lang=${info.project.metadata.locale}`);
  await page.getByRole('row').filter({ hasText: 'Review second' }).getByRole('button', { name: messages.common.open }).click();
  const drawer = page.locator('.ant-drawer-content:visible');
  await expect(drawer.getByText('Follow-up second', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Follow-up first', { exact: true })).toHaveCount(0);
  const selector = drawer.locator('.ant-select').filter({ has: page.locator('#decisionpanel-field-1') });
  await selector.locator('.ant-select-selector').click();
  const option = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle(messages.moderation.actions.reject_append, { exact: true });
  await expect(option).toBeVisible();
  await selector.getByRole('combobox').press('ArrowDown');
  await selector.getByRole('combobox').press('Enter');
  await expect(selector).toContainText(messages.moderation.actions.reject_append);
  const category = drawer.locator('.ant-select').filter({ has: page.locator('#decisionpanel-field-category') });
  await category.locator('.ant-select-selector').click();
  await category.getByRole('combobox').fill(messages.moderation.categories.other);
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByTitle(messages.moderation.categories.other, { exact: true }).click();
  const reason = drawer.locator('#decisionpanel-field-4');
  const submit = drawer.locator('button[type="submit"]');
  const acceptedReason = '😀'.repeat(2000);
  const rejectedReason = `${acceptedReason}😀`;
  await reason.fill(rejectedReason);
  await expect(reason).toHaveValue(rejectedReason);
  await expect(submit).toBeDisabled();
  await reason.evaluate((field) => field.closest('form').requestSubmit());
  expect(decisions).toEqual([]);
  await reason.fill(acceptedReason);
  await submit.click();
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0]).toMatchObject({
    object_id: entry.id,
    append_id: 'second',
    action: 'reject_append',
    category: 'other',
    reason: acceptedReason,
  });
  expect(tasks[0].state).toBe('waiting');
});

test('the queue shows each task category and filters by a chosen category', async ({ page }, info) => {
  await schoolSession(page);
  await mockCatalogSchool(page);
  const m = catalogue(info).moderation;
  const queries = [];
  await page.route('**/api/v1/moderation/tasks**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/summary')) {
      return route.fulfill({ json: queueSummary({ waiting: 2, byCategory: { privacy_leak: 1 } }) });
    }
    if (u.pathname !== '/api/v1/moderation/tasks') return route.fallback();
    queries.push(u.searchParams.get('category') ?? '');
    const categorised = { ...makeTask('task-1', 'entry-1'), submission: { ...makeTask('task-1', 'entry-1').submission, category: 'privacy_leak' } };
    const plain = makeTask('task-2', 'entry-2');
    return route.fulfill({ json: u.searchParams.get('category') ? [categorised] : [categorised, plain] });
  });
  await page.goto(`${base}/moderation/queue?lang=${info.project.metadata.locale}`);
  await expect(page.getByRole('cell', { name: m.categories.privacy_leak, exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: m.uncategorized, exact: true })).toBeVisible();
  await page.locator('.ant-select').filter({ has: page.locator('#moderationview-field-category') }).click();
  await page.locator('#moderationview-field-category').fill(m.categories.privacy_leak);
  await page.locator('.ant-select-item-option').filter({ hasText: m.categories.privacy_leak }).first().click();
  await page.locator('form button[type="submit"]').first().click();
  await expect.poll(() => queries.at(-1)).toBe('privacy_leak');
});
