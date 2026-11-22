import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';

const base = 'http://127.0.0.1:18786';
const docsRoute = '/system/legal/documents';
const varsRoute = '/system/legal/variables';
const legalApi = '/api/v1/admin/legal';
const docPath = '/documents/terms/versions/3.1';
const varPath = '/variables/service_operator';
const actor = { issuer: 'https://example.test', subject: 'fixture-admin' };
const digest = 'a'.repeat(64);
const publishedAt = '2026-01-01T00:00:00Z';
const markdown = '# Service terms\n\nOperated by {{service_operator}}.';
const termsDraft = {
  slug: 'terms',
  title: 'Terms draft',
  version: '3.1',
  status: 'draft',
  revision: 4,
  markdown,
  effective_date: '2026-01-01',
  changed_variables: [],
};
const renderedHtml =
  '<h1>Rendered service terms</h1><p>Fixture service operator</p>';
const termsPublished = {
  ...termsDraft,
  title: 'Terms of Service',
  version: '3.0',
  status: 'published',
  revision: 2,
  html: renderedHtml,
  digest,
  published_at: publishedAt,
  published_by: actor,
};
const privacyPublished = {
  ...termsPublished,
  slug: 'privacy',
  title: 'Privacy Policy',
};
const legalVariable = {
  key: 'service_operator',
  description: 'Organization operating the service',
  value: 'Fixture service operator',
  revision: 7,
  updated_at: publishedAt,
  updated_by: actor,
};

function labels(info) {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
}

function format(label, fields) {
  return label.replaceAll(/\{(\w+)\}/g, (match, key) => fields[key] ?? match);
}

function button(scope, name) {
  return scope.getByRole('button', { exact: true, name });
}

function visit(page, info, path) {
  return page.goto(`${base}${path}?lang=${info.project.metadata.locale}`);
}

function metadata({ html: _html, markdown: _markdown, ...rest }) {
  return rest;
}

function liveVersion(document) {
  return {
    digest: document.digest,
    effective_date: document.effective_date,
    html: document.html,
    published_at: document.published_at,
    slug: document.slug,
    title: document.title,
    version: document.version,
  };
}

function fail(route, status, code) {
  return route.fulfill({ status, json: { code } });
}

async function legalFixture(page, handlers = {}) {
  await schoolSession(page);
  const csrf = randomUUID();
  await page
    .context()
    .addCookies([{ url: base, name: 'stuhelper_csrf', value: csrf }]);
  const state = {
    document: { ...termsDraft },
    variable: { ...legalVariable },
    createdVariable: undefined,
    currentTerms: termsPublished,
    writes: [],
    previews: [],
    reads: [],
  };
  await page.route('**/api/v1/legal/documents/*', (route) => {
    const slug = new URL(route.request().url()).pathname.split('/').at(-1);
    if (slug === 'terms' && state.currentTerms)
      return route.fulfill({ json: liveVersion(state.currentTerms) });
    if (slug === 'privacy')
      return route.fulfill({ json: liveVersion(privacyPublished) });
    return fail(route, 404, 'not_found');
  });
  await page.route('**/api/v1/admin/legal/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.slice(legalApi.length);
    const method = req.method();
    const query = url.searchParams;
    let request;
    if (method === 'GET') {
      state.reads.push({
        path,
        offset: query.get('offset'),
        limit: query.get('limit'),
      });
    } else {
      const headers = req.headers();
      expect(headers['x-csrf-token'] === csrf).toBe(true);
      request = {
        method,
        path,
        body: req.postDataJSON(),
        key: headers['idempotency-key'],
        ifMatch: headers['if-match'],
      };
      if (path.endsWith('/preview')) {
        expect(request.key).toBeUndefined();
        state.previews.push(request);
      } else {
        expect(request.key).toEqual(expect.any(String));
        expect(request.key.length).toBeGreaterThan(0);
        state.writes.push(request);
      }
    }
    const override = handlers[`${method} ${path}`];
    if (override) return override({ route, state, request, query });
    if (method !== 'GET') return fail(route, 405, 'unexpected_fixture_method');
    switch (path) {
      case '/documents': {
        return route.fulfill({
          json: { items: [metadata(termsPublished), metadata(state.document)] },
        });
      }
      case '/documents/terms/versions/3.0': {
        return route.fulfill({ json: termsPublished });
      }
      case '/variables': {
        return route.fulfill({
          json: {
            items: [state.variable, state.createdVariable].filter(Boolean),
          },
        });
      }
      case docPath: {
        return route.fulfill({ json: state.document });
      }
      case varPath: {
        return state.variable
          ? route.fulfill({ json: state.variable })
          : fail(route, 404, 'not_found');
      }
      default: {
        return fail(route, 404, 'not_found');
      }
    }
  });
  return state;
}

async function openVersion(page, copy, version = '3.1') {
  await button(page, format(copy.openVersion, { version })).click();
}

async function fits(page, info) {
  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function screenshot(page, info, view) {
  const dir = process.env.LEGALADMIN_SHOTS_DIR;
  if (dir) {
    await page.screenshot({
      fullPage: true,
      path: resolve(dir, `${info.project.name}-${view}.png`),
    });
  }
}

test('legal documents paginate version rows and show the effective version', async ({
  page,
}, info) => {
  const {
    common,
    legal: { documents: copy },
    menu,
  } = labels(info);
  const state = await legalFixture(page, {
    'GET /documents': ({ query, route }) => {
      if (query.get('limit') === '1') {
        return route.fulfill({
          json: { items: [metadata(termsPublished)], next_offset: 1 },
        });
      }
      if (query.get('offset') === '2') {
        return route.fulfill({ json: { items: [metadata(privacyPublished)] } });
      }
      return route.fulfill({
        json: {
          items: [metadata(termsPublished), metadata(termsDraft)],
          next_offset: 2,
        },
      });
    },
  });
  await visit(page, info, docsRoute);
  const table = page.getByRole('table');
  const draft = table.getByRole('row').filter({ hasText: termsDraft.title });
  await expect(draft.getByText(termsDraft.slug, { exact: true })).toBeVisible();
  await expect(
    draft.getByText(termsPublished.version, { exact: true }),
  ).toBeVisible();
  await expect(draft.getByText(copy.draft, { exact: true })).toBeVisible();
  if (info.project.name.startsWith('desktop-')) {
    await expect(page.locator(`a[href="${docsRoute}"]`).first()).toContainText(
      menu.legalDocuments,
    );
  }
  await fits(page, info);
  await screenshot(page, info, 'documents');
  await button(page, common.next).click();
  await expect(
    table.getByText(privacyPublished.title, { exact: true }),
  ).toBeVisible();
  await expect(draft).toHaveCount(0);
  expect(state.reads).toContainEqual(
    expect.objectContaining({ path: '/documents', offset: '2' }),
  );
  await button(page, copy.previous).click();
  await expect(draft).toBeVisible();
});

test('legal draft saves, validates and isolates preview, then publishes after confirmation', async ({
  page,
}, info) => {
  const {
    common,
    legal: { documents: copy, validation },
  } = labels(info);
  let savedPreviews = 0;
  const changedDigest = 'b'.repeat(64);
  const newerHtml = '<h1>Service terms with the updated variable</h1>';
  const state = await legalFixture(page, {
    [`PUT ${docPath}`]: ({ route, state, request }) => {
      state.document = {
        ...state.document,
        ...request.body,
        revision: state.document.revision + 1,
      };
      return route.fulfill({ json: state.document });
    },
    [`POST ${docPath}/preview`]: ({ route, request }) => {
      if (request.body?.markdown.includes('missing_variable')) {
        return route.fulfill({
          status: 422,
          json: {
            code: 'validation_failed',
            issues: [{ code: 'undefined_variable', key: 'missing_variable' }],
          },
        });
      }
      if (request.body === null) savedPreviews += 1;
      return route.fulfill({
        json:
          savedPreviews > 2
            ? {
                title: 'Changed service terms',
                html: newerHtml,
                digest: changedDigest,
              }
            : {
                title: 'Rendered service terms',
                html: `${renderedHtml}<script>document.body.dataset.previewRan = 'true'</script>`,
                digest,
              },
      });
    },
    [`POST ${docPath}/publish`]: ({ route, state }) => {
      state.document = {
        ...state.document,
        status: 'published',
        revision: state.document.revision + 1,
        html: newerHtml,
        digest: changedDigest,
        published_at: publishedAt,
        published_by: actor,
      };
      state.currentTerms = state.document;
      return route.fulfill({ json: state.document });
    },
  });
  await visit(page, info, docsRoute);
  await openVersion(page, copy);
  const editor = page.getByLabel(copy.markdown, { exact: true });
  const dialog = page.getByRole('dialog');
  await expect(editor).toHaveValue(markdown);
  await expect(editor).toHaveCSS('font-family', /mono/i);

  await editor.fill('{{missing_variable}}');
  await button(page, copy.preview).click();
  const issue = dialog
    .getByRole('listitem')
    .filter({ hasText: validation.undefined_variable });
  await expect(issue).toContainText('missing_variable');
  expect(state.writes).toEqual([]);
  await button(dialog, common.cancel).click();
  await expect(dialog).toHaveCount(0);

  await editor.fill(`${markdown}\n\nUpdated draft.`);
  const save = button(page, copy.saveDraft);
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText(common.saved, { exact: true })).toBeVisible();
  expect(state.writes[0]).toMatchObject({
    method: 'PUT',
    path: docPath,
    ifMatch: '"4"',
    body: {
      title: termsDraft.title,
      markdown: `${markdown}\n\nUpdated draft.`,
      effective_date: '2026-01-01',
    },
  });

  await button(page, copy.preview).click();
  const selector = `iframe[title=${JSON.stringify(copy.previewFrame)}]`;
  const frame = page.frameLocator(selector);
  await expect(
    frame.getByRole('heading', { name: 'Rendered service terms' }),
  ).toBeVisible();
  await expect(page.locator(selector)).toHaveAttribute(
    'sandbox',
    /^(?!.*allow-scripts).*$/,
  );
  await expect(frame.locator('body')).not.toHaveAttribute(
    'data-preview-ran',
    'true',
  );
  await fits(page, info);
  await screenshot(page, info, 'draft-preview');
  await button(dialog, common.cancel).click();
  await expect(dialog).toHaveCount(0);

  await button(page, copy.publish).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(
      format(copy.publishTitle, { version: termsDraft.version }),
      { exact: true },
    ),
  ).toBeVisible();
  await expect(button(dialog, copy.confirmPublish)).toBeEnabled();
  expect(state.previews.at(-1).body).toBeNull();
  expect(state.writes).toHaveLength(1);
  await button(dialog, common.cancel).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes).toHaveLength(1);

  await button(page, copy.publish).click();
  const confirm = button(dialog, copy.confirmPublish);
  await confirm.click();
  await expect(
    dialog.getByText(copy.publicationChanged, { exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByRole('heading', {
      name: 'Service terms with the updated variable',
    }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(copy.publishedNotice, { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1]).toMatchObject({
    method: 'POST',
    path: `${docPath}/publish`,
    body: null,
    ifMatch: '"5"',
  });
  expect(state.writes[1].key).not.toBe(state.writes[0].key);
  expect(savedPreviews).toBe(4);
});

test('legal draft conflict keeps input and uncertain writes replay only the original request', async ({
  page,
}, info) => {
  const {
    common,
    legal: { documents: copy },
  } = labels(info);
  const state = await legalFixture(page, {
    [`PUT ${docPath}`]: ({ route, state, request }) => {
      if (state.writes.length === 1) {
        state.document = {
          ...state.document,
          markdown: 'Server revision',
          revision: 5,
        };
        return fail(route, 409, 'revision_conflict');
      }
      if (state.writes.length === 2) return route.abort();
      state.document = { ...state.document, ...request.body, revision: 6 };
      return route.fulfill({ json: state.document });
    },
  });
  await visit(page, info, docsRoute);
  await openVersion(page, copy);
  const editor = page.getByLabel(copy.markdown, { exact: true });
  await editor.fill('Unsaved operator changes');
  const dismiss = page.waitForEvent('dialog').then(async (dialog) => {
    expect(dialog.message()).toBe(common.leaveUnsaved);
    await dialog.dismiss();
  });
  await button(page, copy.back).click();
  await dismiss;
  await expect(editor).toHaveValue('Unsaved operator changes');

  await button(page, copy.saveDraft).click();
  await expect(
    page.getByText(common.compareNotice, { exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveValue('Unsaved operator changes');
  expect(state.reads.filter((read) => read.path === docPath)).toHaveLength(2);
  await page.getByText(copy.serverDraft, { exact: true }).click();
  await expect(
    page.getByText('Server revision', { exact: true }),
  ).toBeVisible();

  await button(page, copy.saveDraft).click();
  await expect(page.getByText(common.uncertain, { exact: true })).toBeVisible();
  await expect(editor).toBeDisabled();
  await expect(button(page, copy.saveDraft)).toBeDisabled();
  await expect(button(page, copy.preview)).toBeDisabled();
  await expect(editor).toHaveValue('Unsaved operator changes');
  await button(page, common.retryOriginal).click();
  await expect(page.getByText(common.saved, { exact: true })).toBeVisible();
  await expect(editor).toBeEnabled();
  expect(state.writes).toHaveLength(3);
  expect(state.writes[0].ifMatch).toBe('"4"');
  expect(state.writes[1].ifMatch).toBe('"5"');
  expect(state.writes[1].key).not.toBe(state.writes[0].key);
  expect(state.writes[2]).toEqual(state.writes[1]);
});

test('legal variables create, edit and delete with the affected published versions', async ({
  page,
}, info) => {
  const {
    common,
    legal: { variables: copy },
  } = labels(info);
  const createdKey = 'support_reference';
  const changed = metadata({
    ...privacyPublished,
    changed_variables: [legalVariable.key],
  });
  const archived = metadata({
    ...termsPublished,
    version: '2.0',
    status: 'archived',
    changed_variables: [legalVariable.key],
  });
  const state = await legalFixture(page, {
    'POST /variables': ({ route, state, request }) => {
      state.createdVariable = {
        ...legalVariable,
        ...request.body,
        revision: 1,
      };
      return route.fulfill({ status: 201, json: state.createdVariable });
    },
    [`PUT ${varPath}`]: ({ route, state, request }) => {
      state.variable = { ...state.variable, ...request.body, revision: 8 };
      return route.fulfill({ json: state.variable });
    },
    [`DELETE ${varPath}`]: ({ route, state }) => {
      state.variable = undefined;
      return route.fulfill({ status: 204 });
    },
    'GET /documents': ({ query, route }) => {
      if (query.get('limit') === '1') {
        return route.fulfill({
          json: { items: [metadata(termsPublished)], next_offset: 1 },
        });
      }
      if (query.get('offset') === '2') {
        return route.fulfill({ json: { items: [changed, archived] } });
      }
      return route.fulfill({
        json: {
          items: [metadata(termsPublished), metadata(termsDraft)],
          next_offset: 2,
        },
      });
    },
  });
  await visit(page, info, varsRoute);
  await expect(
    page.getByRole('heading', { name: copy.title, exact: true }),
  ).toBeVisible();
  const article = page.locator('article').filter({
    has: page.getByRole('heading', { name: legalVariable.key, exact: true }),
  });
  await expect(article).toContainText(legalVariable.value);

  const dialog = page.getByRole('dialog');
  await button(page, copy.newVariable).click();
  await dialog.getByLabel(copy.key, { exact: true }).fill(createdKey);
  await dialog
    .getByLabel(copy.description, { exact: true })
    .fill('Fixture label');
  await dialog.getByLabel(copy.value, { exact: true }).fill('Fixture value');
  await button(dialog, common.save).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: createdKey, exact: true }),
  ).toBeVisible();
  expect(state.writes[0]).toMatchObject({
    method: 'POST',
    path: '/variables',
    body: {
      key: createdKey,
      description: 'Fixture label',
      value: 'Fixture value',
    },
  });
  expect(state.writes[0].ifMatch).toBeUndefined();

  await button(article, common.edit).click();
  await dialog
    .getByLabel(copy.value, { exact: true })
    .fill('Updated service operator');
  await button(dialog, common.save).click();
  await expect(dialog).toHaveCount(0);
  await expect(article).toContainText('Updated service operator');
  const impactLabel = ({ title, slug, version }) =>
    format(copy.documentVersion, { title, slug, version });
  await expect(
    page.getByRole('heading', { name: copy.impactedTitle, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(impactLabel(changed), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(impactLabel(archived), { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(impactLabel(termsPublished), { exact: true }),
  ).toHaveCount(0);
  expect(state.reads).toContainEqual(
    expect.objectContaining({ path: '/documents', offset: '2' }),
  );
  expect(state.writes[1]).toMatchObject({
    method: 'PUT',
    path: varPath,
    ifMatch: '"7"',
    body: {
      description: legalVariable.description,
      value: 'Updated service operator',
    },
  });
  await fits(page, info);
  await screenshot(page, info, 'variable-impact');

  await button(article, copy.deleteVariable).click();
  await expect(dialog).toBeVisible();
  await button(dialog, copy.deleteVariable).click();
  await expect(dialog).toHaveCount(0);
  await expect(article).toHaveCount(0);
  expect(state.writes[2]).toMatchObject({
    method: 'DELETE',
    path: varPath,
    body: null,
    ifMatch: '"8"',
  });
  expect(new Set(state.writes.map((write) => write.key)).size).toBe(3);
});

test('legal menu follows platform permission for a consent-pending session and revokes displayed data', async ({
  page,
}, info) => {
  const {
    common,
    errors,
    legal: { documents: copy },
    menu,
  } = labels(info);
  let allowed = true;
  const state = await legalFixture(page, {
    'GET /documents': ({ route }) =>
      allowed
        ? route.fulfill({ json: { items: [metadata(termsDraft)] } })
        : fail(route, 403, 'forbidden'),
    [`PUT ${docPath}`]: ({ route }) => {
      allowed = false;
      return fail(route, 403, 'forbidden');
    },
    'GET /variables': ({ route }) => fail(route, 403, 'forbidden'),
  });
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        consent_required: true,
        csrf_token: 'a'.repeat(43),
        expires_at: '2030-01-01T00:00:00Z',
      },
    }),
  );
  await visit(page, info, docsRoute);
  const docsMenu = page.locator(`a[href="${docsRoute}"]`);
  const varsMenu = page.locator(`a[href="${varsRoute}"]`);
  if (info.project.name.startsWith('desktop-')) {
    await expect(docsMenu.first()).toContainText(menu.legalDocuments);
    await expect(varsMenu.first()).toContainText(menu.legalVariables);
    expect(state.reads).toContainEqual(
      expect.objectContaining({ path: '/documents', limit: '1' }),
    );
  }
  await openVersion(page, copy);
  const editor = page.getByLabel(copy.markdown, { exact: true });
  await editor.fill('Sensitive fixture draft');
  await button(page, copy.saveDraft).click();
  await expect(page.getByText(errors.forbidden, { exact: true })).toBeVisible();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText(termsDraft.title, { exact: true })).toHaveCount(
    0,
  );
  await expect(docsMenu).toHaveCount(0);
  await expect(varsMenu).toHaveCount(0);
  await expect(button(page, common.retryOriginal)).toHaveCount(0);
  expect(state.writes).toHaveLength(1);

  await visit(page, info, varsRoute);
  await expect(page.getByText(errors.forbidden, { exact: true })).toBeVisible();
  await expect(page.getByText(legalVariable.key, { exact: true })).toHaveCount(
    0,
  );
  await expect(docsMenu).toHaveCount(0);
  await expect(varsMenu).toHaveCount(0);
});

test('published legal versions expose changed variables, copy to drafts and archive', async ({
  page,
}, info) => {
  const {
    common,
    legal: { documents: copy },
  } = labels(info);
  const publishedPath = '/documents/terms/versions/3.0';
  const newVersion = '4.0';
  const copiedPath = `/documents/terms/versions/${newVersion}`;
  let source = { ...termsPublished, changed_variables: [legalVariable.key] };
  let copied;
  const state = await legalFixture(page, {
    'GET /documents': ({ route, state }) =>
      route.fulfill({
        json: {
          items: [source, state.document, copied].filter(Boolean).map((item) => metadata(item)),
        },
      }),
    [`GET ${publishedPath}`]: ({ route }) => route.fulfill({ json: source }),
    [`GET ${copiedPath}`]: ({ route }) => route.fulfill({ json: copied }),
    'POST /documents/terms/versions': ({ route, request }) => {
      const { effective_date, ...body } = request.body;
      copied = {
        ...body,
        slug: source.slug,
        status: 'draft',
        revision: 1,
        changed_variables: [],
      };
      if (effective_date) copied.effective_date = effective_date;
      return route.fulfill({ status: 201, json: copied });
    },
    [`POST ${publishedPath}/archive`]: ({ route, state }) => {
      source = {
        ...source,
        status: 'archived',
        revision: 3,
        changed_variables: [],
      };
      state.currentTerms = undefined;
      return route.fulfill({ json: source });
    },
  });

  await visit(page, info, docsRoute);
  await openVersion(page, copy, '3.0');
  await expect(
    page.getByText(copy.changedVariables, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(legalVariable.key, { exact: true }),
  ).toBeVisible();
  await button(page, copy.copyDraft).click();
  await expect(
    page.getByLabel(copy.documentTitle, { exact: true }),
  ).toHaveValue(source.title);
  await expect(page.getByLabel(copy.markdown, { exact: true })).toHaveValue(
    source.markdown,
  );
  await expect(
    page.getByLabel(copy.effectiveDate, { exact: true }),
  ).toHaveValue('');
  await page.getByLabel(copy.version, { exact: true }).fill(newVersion);
  await button(page, copy.saveDraft).click();
  await expect(page.getByText(common.saved, { exact: true })).toBeVisible();
  expect(state.writes[0]).toMatchObject({
    method: 'POST',
    path: '/documents/terms/versions',
    body: {
      title: source.title,
      version: newVersion,
      markdown: source.markdown,
      effective_date: null,
    },
  });
  expect(state.writes[0].ifMatch).toBeUndefined();

  await button(page, copy.back).click();
  await openVersion(page, copy, '3.0');
  await button(page, copy.archive).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText(format(copy.archiveTitle, { version: '3.0' }), {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  await button(dialog, common.confirm).click();
  await expect(
    page.getByText(copy.archivedNotice, { exact: true }),
  ).toBeVisible();
  expect(state.writes[1]).toMatchObject({
    method: 'POST',
    path: `${publishedPath}/archive`,
    body: null,
    ifMatch: '"2"',
  });
  await button(page, copy.back).click();
  const old = page.getByRole('row').filter({
    has: button(page, format(copy.openVersion, { version: '3.0' })),
  });
  await expect(old.getByText(copy.archived, { exact: true })).toBeVisible();
  await expect(old.getByText(copy.notPublished, { exact: true })).toBeVisible();
});
