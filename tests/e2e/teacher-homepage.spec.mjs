import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';
import { animation, cdn, interceptMedia } from '../teacher-media-fixture.mjs';
import {
  counts,
  createdAt,
  existingSection,
  fieldLabel,
  photoRequest,
  portrait,
  secondSite,
  secondTeacher,
  siteSummary,
  teacher,
  teacherHomepageFixture,
  textRequest,
} from './teacher-homepage-fixture.mjs';

const base = 'http://127.0.0.1:18786';
const pages = '/catalog/teacher-sites';

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/v1\/admin\/legal\/documents(?:\?|$)/, (route) =>
    route.fulfill({ status: 403, json: { code: 'forbidden' } }),
  );
});

function labels(info) {
  const locale = info.project.metadata.locale;
  return JSON.parse(readFileSync(
    `apps/web-antd/src/locales/langs/${locale}/page.json`, 'utf8',
  ));
}

async function open(page, info, path, query = {}) {
  const url = new URL(path, base);
  url.search = new URLSearchParams({ ...query, lang: info.project.metadata.locale });
  await page.goto(url.href);
}

function button(scope, name) {
  return scope.getByRole('button', { name, exact: true });
}

function antSelect(page, inputId) {
  return page.locator('.ant-select').filter({ has: page.locator(`#${inputId}`) });
}

async function chooseAntOption(page, select, label) {
  await select.locator('.ant-select-selector').click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByTitle(label, { exact: true }).click();
}

async function fits(page, info) {
  const direction = info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr';
  await expect(page.locator('html')).toHaveAttribute('dir', direction);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function screenshot(page, info, name) {
  const dir = process.env.TEACHERADMIN_SHOTS_DIR;
  const project = info.project.name;
  if (!dir || !['desktop-ar-EG', 'desktop-zh-CN'].includes(project)) return;
  await page.screenshot({
    path: join(dir, `${name}-${project}.png`),
    animations: 'disabled',
  });
}

test('teacher homepage matching searches both lists, appends candidates and safely resolves a conflict and a lost reply', async ({ page }, info) => {
  await schoolSession(page);
  const calls = await teacherHomepageFixture(page, {
    sitesOnce: true, matchConflict: true, matchTimeout: true,
  });
  const all = labels(info);
  const match = all.teacherHomepage.match;
  await open(page, info, `${pages}/matching`);
  const sites = page.getByRole('region', { name: match.sites, exact: true });
  const teachers = page.getByRole('region', { name: match.teachers, exact: true });
  const detail = page.getByRole('region', { name: match.reviewTitle, exact: true });
  await expect(sites.getByRole('alert')).toContainText(all.errors.unavailable);
  await button(sites, all.common.retry).click();
  await expect(sites.getByText(siteSummary.name, { exact: true })).toBeVisible();
  await button(sites, all.common.loadMore).click();
  await expect(sites.getByText(secondSite.name, { exact: true })).toBeVisible();
  await expect(sites.getByText(siteSummary.name, { exact: true })).toBeVisible();
  await button(teachers, all.common.loadMore).click();
  await expect(teachers.getByText(secondTeacher.name, { exact: true })).toBeVisible();
  expect(calls.filter(({ query }) => query.after).map(({ path, query }) => [path, query.after])).toEqual([
    ['/review/sites', 'site-cursor-2'],
    ['/review/teachers', 'teacher-cursor-2'],
  ]);

  const teacherSearch = teachers.getByLabel(match.searchTeachers, { exact: true });
  await teacherSearch.fill('no matching person');
  await teacherSearch.press('Enter');
  await expect(teachers.getByText(all.common.empty, { exact: true })).toBeVisible();
  await teacherSearch.fill(teacher.name);
  await teacherSearch.press('Enter');
  await expect(teachers.getByText(teacher.name, { exact: true })).toBeVisible();
  const siteSearch = sites.getByLabel(match.searchSites, { exact: true });
  await siteSearch.fill('Lin Zhiyuan');
  await siteSearch.press('Enter');
  await expect(sites.getByText(secondSite.name, { exact: true })).toHaveCount(0);
  await expect.poll(() => calls.filter(({ query }) => query.q === 'Lin Zhiyuan').map(({ path }) => path))
    .toEqual(['/review/teachers', '/review/sites']);
  await chooseAntOption(page, teachers.locator('.ant-select'), all.common.all);
  await fits(page, info);
  await expect.poll(() => calls.some(({ path, query }) => path === '/review/teachers'
    && query.status === 'all' && query.q === teacher.name)).toBe(true);
  await teachers.locator('summary').click();
  await button(teachers, match.locateSite).click();
  await expect(detail.getByText(teacher.department, { exact: true })).toBeVisible();
  await fits(page, info);
  await screenshot(page, info, 'matching');

  async function decide(action) {
    await button(detail, match.action[action]).click();
    await button(page, all.common.confirm).click();
  }
  const writes = () => calls.filter(({ method }) => method === 'PUT');

  await button(detail, match.chooseTeacher).click();
  await decide('bind');
  await expect(page.getByText(match.conflictReloaded, { exact: true })).toBeVisible();
  expect(calls.some(({ path, query }) => path === '/review/sites'
    && query.status === 'all' && query.q === siteSummary.site_id)).toBe(true);
  expect(writes()[0].body).toEqual({
    action: 'bind', teacher_id: teacher.teacher_id, expected_revision: 2,
  });
  await expect(button(detail, match.chooseTeacher)).toHaveAttribute('aria-pressed', 'true');
  await decide('bind');
  await expect(detail.getByText(match.decision.bind, { exact: true })).toBeVisible();
  expect(writes()[1].body).toEqual({
    action: 'bind', teacher_id: teacher.teacher_id, expected_revision: 3,
  });
  expect(writes()[1].key).toBeTruthy();
  expect(writes()[1].key).not.toBe(writes()[0].key);

  await chooseAntOption(page, sites.locator('.ant-select'), match.decided);
  await fits(page, info);
  await expect.poll(() => calls.some(({ path, query }) => path === '/review/sites'
    && query.status === 'decided' && query.q === 'Lin Zhiyuan')).toBe(true);
  await decide('reject');
  await expect(button(page, all.common.retryOriginal)).toBeVisible();
  await expect(button(detail, match.action.revoke)).toBeDisabled();
  await button(page, all.common.retryOriginal).click();
  await expect(detail.getByText(match.decision.reject, { exact: true })).toBeVisible();
  expect(writes()[2].key).toBeTruthy();
  expect(writes()[3]).toEqual(writes()[2]);
  expect(writes()[3].body).toEqual({ action: 'reject', expected_revision: 4 });

  await decide('revoke');
  await expect(detail.getByText(match.decision.none, { exact: true })).toBeVisible();
  expect(writes()[4].body).toEqual({ action: 'revoke', expected_revision: 5 });
});

test('teacher homepage settings show overlapping eligibility counts and save exact labels against the latest allowlist revision', async ({ page }, info) => {
  await schoolSession(page);
  const calls = await teacherHomepageFixture(page, { allowlistConflict: true });
  const all = labels(info);
  const settings = all.teacherHomepage.settings;
  await open(page, info, `${pages}/settings`);
  for (const [category, count] of Object.entries(counts)) {
    await expect(page.getByText(settings.count[category], { exact: true })).toBeVisible();
    await expect(page.getByText(new Intl.NumberFormat(info.project.metadata.locale).format(count), { exact: true })).toBeVisible();
  }
  await expect(page.getByText(settings.countsHint, { exact: true })).toBeVisible();
  await page.getByLabel(settings.label.fields, { exact: true }).fill(fieldLabel);
  await button(page, settings.add).click();
  await expect(button(page, settings.remove.replace('{label}', fieldLabel))).toBeVisible();
  await page.getByText(settings.kind.sections, { exact: true }).click();
  await button(page, settings.remove.replace('{label}', existingSection)).click();

  await button(page, all.common.save).click();
  await expect(page.getByText(settings.conflict, { exact: true })).toBeVisible();
  await button(page, all.common.save).click();
  await expect(page.getByText(all.common.saved, { exact: true })).toBeVisible();

  const writes = calls.filter(({ method }) => method === 'PUT');
  expect(writes.map(({ body }) => body.expected_revision)).toEqual([4, 5]);
  expect(writes[0].body.fields).toHaveLength(2);
  expect(writes[0].body.fields).toEqual(expect.arrayContaining([
    { field: 'position' }, { field: 'fields', label: fieldLabel },
  ]));
  expect(writes[1].body.fields).toHaveLength(3);
  expect(writes[1].body.fields).toEqual(expect.arrayContaining([
    { field: 'position' }, { field: 'degree' }, { field: 'fields', label: fieldLabel },
  ]));
  expect(writes[1].key).toBeTruthy();
  expect(writes[1].key).not.toBe(writes[0].key);
  await page.getByText(settings.kind.fields, { exact: true }).click();
  await expect(button(page, settings.remove.replace('{label}', fieldLabel))).toBeVisible();
  await fits(page, info);
  await screenshot(page, info, 'settings');
});

test('teacher homepage profile keeps edits after capacity rejection, validates a replacement photo and removes the override on request', async ({ page }, info) => {
  await schoolSession(page);
  const calls = await teacherHomepageFixture(page, { capacity: true });
  const mediaReads = await interceptMedia(page, base, () => ({ type: 'image/png', body: portrait }));
  const all = labels(info);
  const profile = all.teacherHomepage.profile;
  await open(page, info, `${pages}/profile`, { teacher_id: teacher.teacher_id });
  await expect(page.getByText('Head of systems research', { exact: true })).toBeVisible();
  const visibility = page.locator('#teacher-homepage-visibility');
  await visibility.selectOption('stopped');
  await page.locator('#teacher-homepage-field').selectOption('photo');
  await page.getByTestId('teacher-homepage-add-rule').click();
  const rule = page.getByTestId('teacher-homepage-rule');
  await rule.getByRole('checkbox', { name: profile.override, exact: true }).check();
  await rule.getByRole('checkbox', { name: profile.hideField, exact: true }).uncheck();
  const photo = page.getByTestId('teacher-homepage-photo-input');
  await photo.setInputFiles({
    name: 'oversized.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
  });
  await expect(page.getByText(profile.photo.tooLarge, { exact: true })).toBeVisible();
  await expect(page.getByTestId('teacher-homepage-photo-preview')).toHaveCount(0);
  await photo.setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: portrait });
  const preview = page.getByTestId('teacher-homepage-photo-preview');
  await expect(preview).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => preview.evaluate((image) => image.naturalWidth)).toBe(8);
  await fits(page, info);
  await screenshot(page, info, 'profile');

  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  const save = page.getByTestId('teacher-homepage-save-profile');
  await save.click();
  await expect(page.getByText(all.errors.teacher_homepage_capacity_exceeded, { exact: true })).toBeVisible();
  await expect(visibility).toHaveValue('stopped');
  await save.click();
  await expect(page.getByText(profile.saved, { exact: true })).toBeVisible();
  const writes = () => calls.filter(({ method }) => method === 'PUT');
  expect(writes()[1].body).toEqual({
    expected_revision: 13,
    page_visibility: 'stopped',
    rules: [{
      field: { field: 'photo' }, hidden: false,
      override: { photo: { content_type: 'image/png', data: portrait.toString('base64') } },
    }],
  });
  expect(writes()[1].key).toBeTruthy();

  await expect(button(page, profile.photo.preview)).toHaveCount(0);
  await visibility.selectOption('visible');
  await save.click();
  await expect.poll(() => writes().length).toBe(3);
  expect(writes()[2].body).toMatchObject({
    expected_revision: 14,
    page_visibility: 'visible',
    rules: [{
      field: { field: 'photo' },
      override: { photo: { id: 'c'.repeat(64) } },
    }],
  });

  const savedPhoto = page.waitForRequest((request) =>
    request.url().includes(`/objects/${teacher.teacher_id}/teacher-homepage/photos/`),
  );
  await button(page, profile.photo.preview).click();
  const photoRequestSent = await savedPhoto;
  expect(photoRequestSent.method()).toBe('GET');
  await expect(preview).toHaveAttribute('src', /^blob:/);
  expect(mediaReads.map(request => new URL(request.url).pathname)).toEqual(['/manual-portrait']);
  await page.getByTestId('teacher-homepage-remove-rule').click();
  await visibility.selectOption('hidden');
  await save.click();
  await expect.poll(() => writes().length).toBe(4);
  expect(writes()[3].body).toEqual({
    expected_revision: 15, page_visibility: 'hidden', rules: [],
  });
});

test('teacher homepage requests preview private photos and submit decisions using the current revisions', async ({ page }, info) => {
  await schoolSession(page);
  const calls = await teacherHomepageFixture(page, { photoOnce: true, requestConflict: true });
  const mediaReads = await interceptMedia(page, base, () => ({ type: 'image/png', body: portrait }));
  const all = labels(info);
  const requests = all.teacherHomepage.requests;
  await open(page, info, `${pages}/requests`);
  await expect(page.getByRole('cell', { name: photoRequest.teacher_id, exact: true })).toBeVisible();
  await button(page, all.common.loadMore).click();
  await expect(page.getByRole('cell', { name: textRequest.teacher_id, exact: true })).toBeVisible();
  expect(calls.some(({ path, query }) => path === '/requests' && query.after === 'request-cursor-2')).toBe(true);

  const drawer = page.locator('.ant-drawer-content:visible');
  const openRequest = async (request) => {
    const row = page.getByRole('row').filter({
      has: page.getByRole('cell', { name: request.teacher_id, exact: true }),
    });
    await button(row, all.common.open).click();
    await expect(drawer.getByText(request.message, { exact: true })).toBeVisible();
  };
  await openRequest(photoRequest);
  await button(drawer, requests.previewPhoto).click();
  await expect(drawer.getByText(all.errors.unavailable, { exact: true })).toBeVisible();
  await button(drawer, all.common.retry).click();
  const img = drawer.getByRole('img', { name: requests.photo, exact: true });
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => img.evaluate((image) => image.naturalWidth)).toBe(8);
  await fits(page, info);
  expect(mediaReads.map(request => new URL(request.url).pathname)).toEqual(['/request-portrait']);
  await screenshot(page, info, 'requests');

  const note = 'Portrait and identity checked.';
  const submit = button(drawer, requests.submit);
  const noteInput = drawer.getByLabel(requests.note, { exact: true });
  await drawer.getByRole('radio', { name: requests.actions.approve, exact: true }).check();
  await noteInput.fill(note);
  await submit.click();
  await expect(drawer.getByText(requests.conflict, { exact: true })).toBeVisible();
  await expect(noteInput).toHaveValue(note);
  await submit.click();
  const writes = () => calls.filter(({ method }) => method === 'PUT');
  await expect.poll(() => writes().length).toBe(2);
  expect(writes().map(({ body }) => body)).toEqual([
    { action: 'approve', expected_revision: 3, expected_homepage_revision: 13, note },
    { action: 'approve', expected_revision: 4, expected_homepage_revision: 14, note },
  ]);
  expect(writes()[1].key).toBeTruthy();
  expect(writes()[1].key).not.toBe(writes()[0].key);

  await expect(drawer.getByText(requests.states.approved, { exact: true })).toBeVisible();
  await page.locator('.ant-drawer-close:visible').click();
  await openRequest(textRequest);
  await drawer.getByRole('radio', { name: requests.actions.reject, exact: true }).check();
  const rejection = 'Please include a verifiable source.';
  await noteInput.fill(rejection);
  await submit.click();
  await expect.poll(() => writes().length).toBe(3);
  expect(writes()[2].body).toEqual({
    action: 'reject', expected_revision: 7, note: rejection,
  });
});

test('teacher homepage read-only staff can examine matches and a forbidden route clears private controls', async ({ page }, info) => {
  await schoolSession(page, 'school', false);
  const calls = await teacherHomepageFixture(page, { permission: 'readonly' });
  const all = labels(info);
  const match = all.teacherHomepage.match;
  await open(page, info, `${pages}/matching`);
  const sites = page.getByRole('region', { name: match.sites, exact: true });
  await expect(sites.getByText(siteSummary.name, { exact: true })).toBeVisible();
  await button(sites, match.reviewSite).click();
  const details = page.getByRole('region', { name: match.reviewTitle, exact: true });
  await expect(details.getByText(teacher.department, { exact: true })).toBeVisible();
  await expect(button(details, match.action.bind)).toHaveCount(0);
  await expect(button(details, match.action.reject)).toHaveCount(0);
  if (info.project.name.startsWith('desktop-')) {
    await expect(page.locator(`a[role="menuitem"][href="${pages}/matching"]`)).toHaveCount(1);
    await expect(page.locator(`a[role="menuitem"][href="${pages}/settings"]`)).toHaveCount(0);
  }

  await open(page, info, `${pages}/settings`);
  await expect(page.getByText(all.errors.forbidden, { exact: true }).first()).toBeVisible();
  await expect(button(page, all.common.save)).toHaveCount(0);
  expect(calls.some(({ path, method }) => path === '/allowlist' && method === 'GET')).toBe(true);
  expect(calls.every(({ method, school }) => method === 'GET' && school === 'school')).toBe(true);
});

test('teacher homepage direct routes wait for consent before requesting school data', async ({ page }, info) => {
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({ json: {
    authenticated: true,
    consent_required: true,
    csrf_token: 'a'.repeat(43),
    expires_at: '2030-01-01T00:00:00Z',
  } }));
  const catalogRequests = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/v1/catalog/')) catalogRequests.push(path);
  });
  const all = labels(info);
  await open(page, info, `${pages}/matching`);
  await expect(page.getByText(all.errors.consent_required, { exact: true }).first()).toBeVisible();
  await expect(page.locator(`a[role="menuitem"][href="${pages}/matching"]`)).toHaveCount(0);

  await open(page, info, `${pages}/profile`, { teacher_id: teacher.teacher_id });
  await expect(page.getByText(all.errors.consent_required, { exact: true }).first()).toBeVisible();
  expect(catalogRequests).toEqual([]);
});

test('teacher homepage complaints use a server-filtered queue and hide or dismiss each selected item', async ({ page }, info) => {
  await schoolSession(page);
  await teacherHomepageFixture(page);
  const all = labels(info);
  const moderation = all.teacherHomepage.moderation;
  const targets = [teacher, secondTeacher].map(({ teacher_id }, index) => ({
    object_id: `teacher-homepage:${teacher_id}`,
    school_id: 'school',
    revision: 13 + index,
    visible: true,
  }));
  const complaints = targets.map((target, index) => ({
    id: `complaint-${index + 1}`,
    school_id: 'school',
    content_kind: 'teacher_homepage',
    submission: {
      object_id: target.object_id,
      kind: 'report',
      reason: `Homepage complaint ${index + 1}`,
      category: 'privacy_leak',
      evidence: [],
    },
    object_revision: target.revision,
    revision: 6 + index,
    state: 'waiting',
    created_at: createdAt,
    updated_at: createdAt,
  }));
  const writes = [];
  const filtered = [];
  await page.route('**/api/v1/moderation/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path === '/api/v1/moderation/tasks/summary') {
      const waiting = url.searchParams.get('include_teacher_homepage') === 'true'
        ? complaints.filter((task) => task.state === 'waiting').length
        : 0;
      return route.fulfill({ json: {
        school_id: 'school', waiting, decided: 0, failed: 0,
        by_content_kind: { course: 0, mentor: 0, reply: 0, resource: 0, teacher_homepage: waiting },
        by_request_kind: { review: 0, report: waiting, edit_request: 0, delete_request: 0, appeal: 0 },
        by_category: waiting ? { privacy_leak: waiting } : {},
      } });
    }
    if (path === '/api/v1/moderation/tasks/page') {
      filtered.push(Object.fromEntries(url.searchParams));
      return route.fulfill({
        json: { items: complaints.filter(({ state }) => state === 'waiting'), next_cursor: '' },
      });
    }
    if (path === '/api/v1/moderation/tasks') return route.fulfill({ json: [] });
    if (path.endsWith('/target')) {
      return route.fulfill({
        json: targets.find(({ object_id }) => object_id.endsWith(`:${path.split('/').at(-2)}`)),
      });
    }
    const task = complaints.find(({ id }) => path.includes(`/${id}`));
    if (task && path.endsWith('/decisions')) {
      const body = req.postDataJSON();
      writes.push({ task: task.id, body, key: req.headers()['idempotency-key'] });
      task.state = 'applied';
      return route.fulfill({ json: { ...task, revision: task.revision + 1, decision: body.decision } });
    }
    if (task) return route.fulfill({ json: task });
    return route.fallback();
  });

  await open(page, info, '/moderation/queue');
  await chooseAntOption(page, antSelect(page, 'moderationview-field-2'), moderation.kind);
  await button(page, all.common.search).click();
  await expect(page.getByText(complaints[0].submission.reason, { exact: true })).toBeVisible();
  expect(filtered[0]).toMatchObject({ school_id: 'school', content_kind: 'teacher_homepage' });

  const drawer = page.locator('.ant-drawer-content:visible');
  const firstRow = page.getByRole('row').filter({ hasText: complaints[0].submission.reason });
  await button(firstRow, all.common.open).click();
  await expect(drawer.getByText(teacher.teacher_id, { exact: true })).toBeVisible();
  await fits(page, info);
  await screenshot(page, info, 'complaints');

  const actionInput = 'teacher-homepage-complaint-action';
  for (const [index, action] of ['hide', 'dismiss'].entries()) {
    const complaint = complaints[index];
    const note = `Reviewed homepage complaint ${index + 1}.`;
    await expect(drawer.getByText(targets[index].object_id.split(':').at(-1), { exact: true })).toBeVisible();
    await chooseAntOption(page, antSelect(page, actionInput), moderation[action]);
    await drawer.locator('#teacher-homepage-complaint-reason').fill(note);
    await button(drawer, all.moderation.applyDecision).click();
    await expect.poll(() => writes.length).toBe(index + 1);
    expect(writes[index]).toMatchObject({
      task: complaint.id,
      body: {
        revision: complaint.revision,
        decision: {
          object_id: complaint.submission.object_id,
          revision: complaint.object_revision,
          action,
          reason: note,
        },
      },
    });
    expect(writes[index].key).toBeTruthy();
  }
  await expect(page.getByText(complaints[0].submission.reason, { exact: true })).toHaveCount(0);
});

test('authorized homepage images follow signed redirects and revoked previews disappear', async ({ page }, info) => {
  await schoolSession(page);
  await teacherHomepageFixture(page);
  const all = labels(info);
  const path = `/api/v1/catalog/objects/${teacher.teacher_id}/teacher-homepage`;
  const photo = { url: path + '/photos/' + 'a'.repeat(64), content_type: 'image/png', width: 8, height: 8 };
  const image = { kind: 'image', field: 'research', title: 'Animated diagram', url: path + '/images/' + 'b'.repeat(64),
    image: { content_type: 'image/gif', width: 8, height: 8, size_bytes: animation.length } };
  await page.route('**' + path, route => route.fulfill({ json: { profile: { name: 'Professor', supervisors: [], fields: [], sections: [], photo } } }));
  await page.route('**' + path + '/media', route => route.fulfill({ json: { items: [image] } }));
  const requests = await interceptMedia(page, base, url => {
    if (url.pathname === '/expired') return { status: 403 };
    if (url.pathname === '/portrait') return { type: 'image/png', body: portrait };
    return {};
  });
  let reads = 0;
  let denied = 0;
  await page.route('**' + photo.url, route => route.fulfill({ status: 302, headers: { location: cdn + '/portrait' } }));
  await page.route('**' + image.url, route => denied
    ? route.fulfill({ status: denied, json: { code: denied === 403 ? 'forbidden' : 'not_found' } })
    : route.fulfill({ status: 302, headers: { location: cdn + (++reads === 1 ? '/expired' : '/gif') } }));
  await open(page, info, pages + '/profile', { teacher_id: teacher.teacher_id });
  await button(page, all.common.open).click();
  await button(page, all.teacherHomepage.fields.photo).click();
  await expect(page.getByRole('img', { name: all.teacherHomepage.fields.photo, exact: true })).toHaveJSProperty('naturalWidth', 8);
  const choose = button(page, image.title);
  const preview = page.getByRole('img', { name: image.title, exact: true });
  await choose.click();
  await expect(preview).toHaveAttribute('src', /^blob:/);
  await expect(preview).toHaveJSProperty('naturalWidth', 8);
  expect(requests.map(request => new URL(request.url).pathname)).toEqual(['/portrait', '/expired', '/gif']);
  for (const status of [403, 404]) {
    const old = await preview.getAttribute('src');
    denied = status;
    await choose.click();
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole('alert').last()).toBeVisible();
    expect(await page.evaluate(async url => {
      try { await fetch(url); return false; } catch { return true; }
    }, old)).toBe(true);
    denied = 0;
    await choose.click();
    await expect(preview).toHaveJSProperty('naturalWidth', 8);
  }
  await button(page, all.teacherHomepage.profile.photo.close).click();
  await expect(preview).toHaveCount(0);
});
