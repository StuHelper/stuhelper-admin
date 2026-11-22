import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';
import { fixture, queueSummary, routes } from './resource-fixture.mjs';

const base = 'http://127.0.0.1:18786';
const tasksPath = /\/api\/v1\/moderation\/tasks(?:\?|$)/;
const summaryPath = /\/api\/v1\/moderation\/tasks\/summary(?:\?|$)/;

const catalogue = (locale) =>
  JSON.parse(
    fs.readFileSync(
      `apps/web-antd/src/locales/langs/${locale}/page.json`,
      'utf8',
    ),
  );

function categoryCard(page, messages) {
  return page.locator('.ant-card').filter({
    has: page.getByText(messages.categorySummary, { exact: true }),
  });
}

function categorySelect(scope, id) {
  return scope
    .locator('.ant-form-item')
    .filter({ has: scope.page().locator(`#${id}`) });
}

async function chooseCategory(select, label) {
  await select.locator('.ant-select-selector').click();
  await select.getByRole('combobox').fill(label);
  await select
    .page()
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByTitle(label, { exact: true })
    .click();
}

function classifiedResource() {
  const state = fixture();
  state.task.submission = {
    ...state.task.submission,
    kind: 'report',
    reason: 'Reported copyright concern',
    category: 'copyright',
  };
  return state;
}

test.beforeEach(async ({ page }) => {
  await schoolSession(page);
});

test('resource review filters tasks and submits the selected violation category', async ({
  page,
}, info) => {
  const { locale } = info.project.metadata;
  const { common, moderation } = catalogue(locale);
  const number = new Intl.NumberFormat(locale);
  const state = classifiedResource();
  const queries = [];
  const uncategorized = {
    ...state.task,
    id: 'uncategorized-task',
    submission: {
      object_id: 'resource:uncategorized-version',
      kind: 'review',
      reason: 'content_review',
      evidence: [],
    },
  };
  await routes(page, state);
  await page.route(tasksPath, (route) => {
    const { searchParams } = new URL(route.request().url());
    queries.push(Object.fromEntries(searchParams));
    const tasks = [state.task, uncategorized].filter(
      (task) =>
        task.state === searchParams.get('state') &&
        (!searchParams.has('category') ||
          task.submission.category === searchParams.get('category')),
    );
    return route.fulfill({ json: tasks });
  });
  await page.route(summaryPath, (route) => {
    const waiting = state.task.state === 'waiting';
    return route.fulfill({
      json: queueSummary({
        waiting: waiting ? 2 : 1,
        resources: waiting ? 2 : 1,
        reviews: 1,
        byCategory: waiting ? { copyright: 1 } : {},
        decided: waiting ? 0 : 1,
      }),
    });
  });

  await page.goto(`${base}/resources/reviews?lang=${locale}`);
  const counts = categoryCard(page, moderation);
  await expect(
    counts.getByText(
      moderation.categorySummaryWaiting.replace('{count}', number.format(2)),
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: moderation.uncategorized, exact: true }),
  ).toBeVisible();
  await chooseCategory(
    categorySelect(page.locator('main'), 'reviewview-field-category'),
    moderation.categories.copyright,
  );
  await page.getByRole('button', { name: common.search, exact: true }).click();
  await expect
    .poll(() => queries.at(-1))
    .toMatchObject({
      school_id: 'school',
      content_kind: 'resource',
      state: 'waiting',
      category: 'copyright',
    });
  await expect(
    page.getByRole('cell', { name: moderation.uncategorized, exact: true }),
  ).toHaveCount(0);
  const row = page
    .getByRole('row')
    .filter({ hasText: state.task.submission.reason });
  await expect(
    row.getByRole('cell', {
      name: moderation.categories.copyright,
      exact: true,
    }),
  ).toBeVisible();
  await row.getByRole('button', { name: common.open, exact: true }).click();

  const drawer = page.locator('.ant-drawer-content');
  const details = drawer.locator('.ant-descriptions');
  await expect(
    details.getByText(moderation.categories.copyright, { exact: true }),
  ).toBeVisible();
  const decisionCategory = categorySelect(
    drawer,
    'reviewview-field-decision-category',
  );
  await expect(decisionCategory).toContainText(moderation.categories.copyright);
  await chooseCategory(
    decisionCategory,
    moderation.categories.academic_integrity,
  );
  await drawer
    .getByLabel(common.reason, { exact: true })
    .fill('The material qualifies as academic misconduct.');
  const reason = drawer.getByLabel(common.reason, { exact: true });
  const submit = drawer.getByRole('button', {
    name: moderation.applyDecision,
    exact: true,
  });
  const acceptedReason = '😀'.repeat(2000);
  const rejectedReason = `${acceptedReason}😀`;
  await reason.fill(rejectedReason);
  await expect(reason).toHaveValue(rejectedReason);
  await expect(submit).toBeDisabled();
  await reason.evaluate((field) => field.closest('form').requestSubmit());
  expect(state.calls.filter((call) => call.path.endsWith('/decisions'))).toEqual([]);
  await reason.fill(acceptedReason);
  await submit.click();
  await expect(drawer.locator('.ant-alert-success')).toBeVisible();
  const decisions = state.calls.filter(
    (call) => call.path === '/api/v1/moderation/tasks/task/decisions',
  );
  expect(decisions).toHaveLength(1);
  expect(decisions[0].body).toMatchObject({
    revision: 1,
    decision: {
      object_id: 'resource:version',
      category: 'academic_integrity',
      reason: acceptedReason,
    },
  });
  await expect(
    details.getByText(moderation.categories.academic_integrity, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    counts.getByText(
      moderation.categorySummaryWaiting.replace('{count}', number.format(1)),
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    counts.getByText(moderation.categorySummaryEmpty, { exact: true }),
  ).toBeVisible();
});

test('resource review confirms before discarding a category-only edit', async ({
  page,
}, info) => {
  const { locale } = info.project.metadata;
  const { common, moderation } = catalogue(locale);
  await routes(page, classifiedResource());
  await page.goto(`${base}/resources/reviews?lang=${locale}`);
  await page.getByRole('button', { name: common.open, exact: true }).click();

  const drawer = page.locator('.ant-drawer-content');
  const decisionCategory = categorySelect(
    drawer,
    'reviewview-field-decision-category',
  );
  await chooseCategory(
    decisionCategory,
    moderation.categories.academic_integrity,
  );
  const confirmations = [];
  page.on('dialog', async (dialog) => {
    confirmations.push(dialog.message());
    await dialog.dismiss();
  });
  await drawer.locator('.ant-drawer-close').click();
  expect(confirmations).toEqual([common.leaveUnsaved]);
  await expect(decisionCategory).toContainText(
    moderation.categories.academic_integrity,
  );
});

async function checkCategoryCounts(page, locale, path, contentKind) {
  const { common, errors, moderation } = catalogue(locale);
  const number = new Intl.NumberFormat(locale);
  const state = fixture();
  const categorized = {
    ...state.task,
    content_kind: contentKind,
    submission: {
      ...state.task.submission,
      kind: 'report',
      category: 'privacy_leak',
    },
  };
  const uncategorized = {
    ...state.task,
    id: 'uncategorized-task',
    content_kind: contentKind,
    submission: { ...state.task.submission, object_id: 'uncategorized-object' },
  };
  const taskQueries = [];
  const summaryQueries = [];
  let releaseFirstResponse;
  const firstResponse = new Promise((resolve) => {
    releaseFirstResponse = resolve;
  });
  await routes(page, state);
  await page.route(tasksPath, (route) => {
    const { searchParams } = new URL(route.request().url());
    taskQueries.push(Object.fromEntries(searchParams));
    return route.fulfill({
      json: searchParams.has('category')
        ? [categorized]
        : [categorized, uncategorized],
    });
  });
  await page.route(summaryPath, async (route) => {
    const { searchParams } = new URL(route.request().url());
    summaryQueries.push(Object.fromEntries(searchParams));
    if (summaryQueries.length === 1) {
      await firstResponse;
      return route.fulfill({ status: 503, json: { code: 'unavailable' } });
    }
    return route.fulfill({
      json: queueSummary({
        waiting: 4,
        resources: 2,
        reviews: 1,
        byCategory: { privacy_leak: 2, copyright: 1 },
      }),
    });
  });

  const counts = categoryCard(page, moderation);
  try {
    await page.goto(`${base}${path}?lang=${locale}`);
    const loading = counts.getByText(common.loading, { exact: true });
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    await expect.poll(() => summaryQueries).toEqual([{ school_id: 'school' }]);
  } finally {
    releaseFirstResponse();
  }

  const alert = counts.getByRole('alert');
  await expect(alert).toContainText(errors.unavailable);
  await alert.getByRole('button', { name: common.retry, exact: true }).click();
  await expect(
    counts.getByText(
      moderation.categorySummaryWaiting.replace('{count}', number.format(4)),
      { exact: true },
    ),
  ).toBeVisible();
  expect(summaryQueries).toEqual([
    { school_id: 'school' },
    { school_id: 'school' },
  ]);
  await expect(alert).toHaveCount(0);

  const privacy = counts.getByRole('button', {
    name: moderation.categories.privacy_leak,
  });
  const copyright = counts.getByRole('button', {
    name: moderation.categories.copyright,
  });
  await expect(
    privacy.getByText(number.format(2), { exact: true }),
  ).toBeVisible();
  await expect(
    copyright.getByText(number.format(1), { exact: true }),
  ).toBeVisible();
  const unclassifiedCell = page.getByRole('cell', {
    name: moderation.uncategorized,
    exact: true,
  });
  await expect(unclassifiedCell).toBeVisible();
  await privacy.click();
  await expect(privacy).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => taskQueries.at(-1))
    .toMatchObject({
      school_id: 'school',
      state: 'waiting',
      category: 'privacy_leak',
      ...(contentKind === 'resource' ? { content_kind: 'resource' } : {}),
    });
  await expect(unclassifiedCell).toHaveCount(0);

  await privacy.click();
  await expect(privacy).toHaveAttribute('aria-pressed', 'false');
  await expect(unclassifiedCell).toBeVisible();
  expect(taskQueries.at(-1)).not.toHaveProperty('category');
}

test('academic queue retries and filters by the school category counts', async ({
  page,
}, info) => {
  await checkCategoryCounts(
    page,
    info.project.metadata.locale,
    '/moderation/queue',
    'course',
  );
});

test('resource queue retries and filters by the school category counts', async ({
  page,
}, info) => {
  await checkCategoryCounts(
    page,
    info.project.metadata.locale,
    '/resources/reviews',
    'resource',
  );
});
