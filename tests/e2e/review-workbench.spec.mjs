import { Buffer } from 'node:buffer';
import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';
import { fixture, queueSummary, routes } from './resource-fixture.mjs';

const catalogue = (info) =>
  JSON.parse(
    fs.readFileSync(
      `apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`,
      'utf8',
    ),
  );
const base = 'http://127.0.0.1:18786';

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

async function scrollIntoViewport(button) {
  // Expanding the history panel can move the button after the drawer first scrolls.
  await expect(async () => {
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport({ timeout: 350 });
  }).toPass({ timeout: 5000 });
}

test('resource review previews sandboxed PDFs, warns above 15 MiB, applies reason presets and advances across pages', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const s = fixture();
  const nextTask = {
    ...s.task,
    id: 'task-page-2',
    submission: {
      ...s.task.submission,
      object_id: 'resource:version-large',
    },
  };
  let decidedFirst = false;
  let deliverFile;
  const delayedFile = new Promise(resolve => { deliverFile = resolve; });
  let waitingForFile = false;
  await routes(page, s);
  await page.route('**/api/v1/moderation/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/summary')) {
      return route.fallback();
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      decidedFirst = true;
      return route.fulfill({
        json: {
          ...s.task,
          revision: 2,
          state: 'decided',
          decision: body.decision,
        },
      });
    }
    if (url.pathname === '/api/v1/moderation/tasks') {
      return route.fulfill({ json: decidedFirst ? [nextTask] : [s.task] });
    }
    if (url.pathname.endsWith('/task-page-2')) {
      return route.fulfill({ json: nextTask });
    }
    return route.fulfill({ json: s.task });
  });
  await page.route('**/api/v1/resources/review/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/file')) {
      waitingForFile = true;
      await delayedFile;
      return route.fulfill({
        body: Buffer.from('%PDF-1.4\n%EOF\n'),
        contentType: 'application/pdf',
      });
    }
    const large = url.pathname.includes('version-large');
    const pdfFile = {
      ...s.file,
      filename: large ? 'huge-pack.pdf' : 'lecture-notes.pdf',
      content_type: 'application/pdf',
      size: large ? 16 * 1024 * 1024 : 2048,
    };
    return route.fulfill({
      json: {
        ...s.resource,
        current: undefined,
        proposal: {
          ...s.version,
          id: large ? 'version-large' : 'version',
          metadata: {
            ...s.metadata,
            title: large ? 'Oversized PDF' : 'Sandboxed PDF',
          },
          file: pdfFile,
          state: 'pending',
        },
        download_allowed: false,
      },
    });
  });

  await page.goto(`${base}/resources/reviews?lang=${info.project.metadata.locale}`);
  await page.getByRole('button', { name: all.common.open, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByText('Sandboxed PDF', { exact: true })).toBeVisible();

  await drawer
    .getByRole('button', { name: all.resources.previewFile, exact: true })
    .click();
  await expect.poll(() => waitingForFile).toBe(true);
  await drawer.locator('.ant-drawer-close').click();
  await page.getByRole('button', { name: all.common.open, exact: true }).click();
  await expect(drawer.getByText('Sandboxed PDF', { exact: true })).toBeVisible();
  const received = page.waitForResponse(response => response.url().endsWith('/file'));
  deliverFile();
  const response = await received;
  await response.finished();
  await expect(drawer.getByRole('button', { name: all.resources.previewFile, exact: true })).not.toHaveClass(/ant-btn-loading/);
  await expect(drawer.locator('iframe')).toHaveCount(0);
  await drawer.getByRole('button', { name: all.resources.previewFile, exact: true }).click();
  const frame = drawer.locator('iframe[sandbox=""]');
  await expect(frame).toBeVisible();

  await drawer
    .getByRole('button', { name: all.resources.presets.approved, exact: true })
    .click();
  await expect(drawer.getByLabel(all.common.reason, { exact: true })).toHaveValue(
    all.resources.presets.approved,
  );

  await drawer
    .getByRole('button', { name: all.moderation.applyDecision, exact: true })
    .click();
  await expect(drawer.getByText('Oversized PDF', { exact: true })).toBeVisible();
  await expect(
    drawer.getByText(all.resources.previewTooLarge, { exact: true }),
  ).toBeVisible();
  await fits(page, info);
});

test('moderation decision panel shows target course and term, highlights proposed edits and appends older versions', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const entry = {
    id: 'entry-1',
    root_id: 'entry-1',
    school_id: 'school',
    input: {
      kind: 'course',
      target_id: 'course-cs101',
      term_id: 'term-2026f',
      teacher_id: 'teacher-1',
      title: 'Initial thoughts',
      body: 'Pace is fast and homework is heavy.',
      ratings: [4, 4, 3, 4, 5],
      signed: false,
    },
    author_handle: 'student-handle',
    anonymous: true,
    state: 'published',
    revision: 25,
    created_at: '2026-10-01T00:00:00Z',
    published_at: '2026-10-01T00:00:00Z',
    featured: false,
  };
  const editTask = {
    id: 'mod-edit-1',
    school_id: 'school',
    content_kind: 'review',
    submission: {
      object_id: 'entry-1',
      kind: 'edit_request',
      reason: 'Update after midterm',
      proposed_body: 'Pace is balanced and homework is manageable.',
      evidence: [],
    },
    object_revision: 25,
    revision: 1,
    state: 'waiting',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  };

  await page.route('**/api/v1/catalog/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/lookup')) {
      return route.fulfill({
        json: {
          items: [
            {
              id: 'course-cs101',
              kind: 'course',
              school_id: 'school',
              code: 'CS101',
              name: 'Operating Systems',
              credits: 4,
              aliases: [],
              revision: 1,
              updated_at: '2026-09-01T00:00:00Z',
            },
            {
              id: 'term-2026f',
              kind: 'term',
              school_id: 'school',
              name: '2026 Autumn',
              credits: null,
              aliases: [],
              revision: 1,
              updated_at: '2026-09-01T00:00:00Z',
            },
          ],
          missing_ids: [],
        },
      });
    }
    const kind = url.searchParams.get('kind');
    return route.fulfill({
      json: {
        items: [
          {
            id: kind === 'school' ? 'school' : 'teacher-1',
            kind: kind || 'teacher',
            school_id: 'school',
            name: kind === 'school' ? 'Demo University' : 'Prof. Chen',
            credits: null,
            aliases: [],
            revision: 1,
            updated_at: '2026-09-01T00:00:00Z',
          },
        ],
        next: '',
      },
    });
  });

  await page.route('**/api/v1/moderation/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/summary')) {
      return route.fulfill({ json: queueSummary({ waiting: 1 }) });
    }
    if (url.pathname === '/api/v1/moderation/tasks') {
      return route.fulfill({
        json: url.searchParams.get('object_id') ? [editTask] : [editTask],
      });
    }
    return route.fulfill({ json: editTask });
  });

  await page.route('**/api/v1/reviews/admin/entries/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/history')) {
      const before = Number(url.searchParams.get('before') || 26);
      const count = before === 26 ? 20 : 2;
      const items = Array.from({ length: count }, (_, idx) => ({
        ...entry,
        revision: before - 1 - idx,
        input: { ...entry.input, body: `Revision body #${before - 1 - idx}` },
        change_origin: 'author',
      }));
      return route.fulfill({ json: items });
    }
    return route.fulfill({ json: entry });
  });

  await page.goto(`${base}/moderation/queue?lang=${info.project.metadata.locale}`);
  await page.getByRole('button', { name: all.common.open, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByText('Operating Systems (CS101)', { exact: true })).toBeVisible();
  await expect(drawer.getByText('2026 Autumn', { exact: true })).toBeVisible();
  await expect(drawer.locator('del').first()).toContainText('fast');
  await expect(drawer.locator('ins').first()).toContainText('balanced');

  await drawer.getByText(all.moderation.versions, { exact: true }).click();
  await expect(drawer.locator('article').last()).toContainText('Revision body #6');
  await expect(drawer.locator('article').last().locator('del, ins')).toHaveCount(0);
  await drawer
    .getByRole('button', { name: all.moderation.showPlain, exact: true })
    .first().click();
  await expect(drawer.locator('del')).toHaveCount(0);
  await expect(drawer.getByText('Revision body #25', { exact: true })).toBeVisible();

  const olderBtn = drawer.getByRole('button', {
    name: all.moderation.olderVersions,
    exact: true,
  });
  await scrollIntoViewport(olderBtn);
  await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/v1/reviews/admin/entries/entry-1/history' &&
        url.searchParams.get('before') === '6' &&
        response.ok()
      );
    }),
    olderBtn.click(),
  ]);
  // Both newest (#25) and appended older (#4) revisions remain on screen.
  await expect(drawer.getByText('Revision body #25', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Revision body #4', { exact: true })).toBeVisible();
  const latestBtn = drawer.getByRole('button', {
    name: all.moderation.latestVersions,
    exact: true,
  });
  await scrollIntoViewport(latestBtn);
  await latestBtn.click();
  await expect(drawer.getByText('Revision body #4', { exact: true })).toHaveCount(0);
  await fits(page, info);
});

test('student verification filters by status in page state, previews materials, fills presets and advances continuously', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  const school = {
    id: 'school',
    name: 'Demo University',
    enabled: true,
    methods: ['manual_material_review'],
    notice_version: 'v1',
    opening_date: '2026-09-01',
    newcomer_days: 30,
    email_domain: 'demo.edu',
    material_types: ['student_card'],
    revision: 1,
  };
  const appRow = (id, state) => ({
    id,
    school_id: 'school',
    method: 'manual_material_review',
    stage: 'bachelor',
    kind: 'student',
    state,
    revision: 1,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
    expires_at: '2026-12-01T00:00:00Z',
    credential_id: '',
    result_code: '',
  });
  const apps = [
    appRow('a1', 'pending_review'),
    appRow('a2', 'pending_review'),
    appRow('a3', 'pending_review'),
    appRow('a4', 'approved'),
  ];

  let failNextRead = true;
  const reviewed = [];
  const downloads = [];
  await page.route('**/api/v1/**verification/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'GET') {
      if (path === '/api/v1/admin/verification/access') {
        return route.fulfill({ json: { allowed: true } });
      }
      if (path === '/api/v1/verification/schools') {
        return route.fulfill({ json: [school] });
      }
      if (path === '/api/v1/admin/verification/schools/school/applications') {
        return route.fulfill({ json: apps });
      }
      if (path.endsWith('/form')) {
        const isSecond = path.includes('/a2/');
        if (isSecond && failNextRead) {
          failNextRead = false;
          return route.fulfill({ status: 503, json: { code: 'unavailable' } });
        }
        return route.fulfill({
          json: {
            student_id: `2026000${path.split('/').at(-2).slice(1)}`,
            name: isSecond ? 'Bob' : 'Alice',
            department: 'CS',
            email: 'stu@demo.edu',
            material_type: 'student_card',
            material_ids: ['m1'],
            revision: 1,
          },
        });
      }
      if (path.endsWith('/materials')) {
        return route.fulfill({
          json: [
            {
              id: 'm1',
              application_id: 'a1',
              content_type: 'image/png',
              size: pixel.length,
              created_at: '2026-11-01T00:00:00Z',
            },
            { id: 'm2', application_id: 'a1', content_type: 'application/pdf',
              size: 16 * 1024 * 1024, created_at: '2026-11-01T00:00:00Z' },
          ],
        });
      }
      if (path === '/api/v1/verification/materials/m2') {
        downloads.push(req.resourceType());
        return route.fulfill({ body: '%PDF-1.4 sample', contentType: 'application/pdf' });
      }
      if (path === '/api/v1/verification/materials/m1') {
        return route.fulfill({ body: pixel, contentType: 'image/png' });
      }
      return route.fulfill({ status: 404, json: { code: 'not_found' } });
    }
    const applicationId = path.split('/').at(-2);
    reviewed.push(applicationId);
    const body = req.postDataJSON();
    return route.fulfill({
      json: { ...appRow(applicationId, 'supplement_required'), revision: 2, review_note: body.note },
    });
  });

  await page.goto(`${base}/verification?lang=${info.project.metadata.locale}`);
  await page
    .locator('.ant-form-item')
    .filter({ hasText: all.common.status })
    .locator('.ant-select-selector')
    .click();
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByTitle(all.verification.states.pending_review, { exact: true })
    .click();
  // Filter stays in page state: URL never gains filter query params or hash.
  expect(new URL(page.url()).searchParams.get('state')).toBeNull();
  expect(new URL(page.url()).hash).toBe('');
  await expect(
    page.getByRole('cell', { name: all.verification.states.approved, exact: true }),
  ).toHaveCount(0);

  await page
    .getByRole('button', { name: all.verification.review, exact: true })
    .first()
    .click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByText('20260001', { exact: true })).toBeVisible();
  expect(downloads).toEqual([]);
  const download = page.waitForEvent('download');
  await drawer.getByRole('button', { name: all.resources.downloadFile, exact: true }).click();
  await download;
  expect(downloads).toEqual(['fetch']);
  await drawer
    .getByRole('button', { name: all.resources.rotateRight, exact: true })
    .click();
  await drawer
    .getByRole('button', { name: all.verification.presets.blurry, exact: true })
    .click();
  await drawer
    .getByRole('button', { name: all.verification.supplement, exact: true })
    .click();
  // The first decision remains successful when the next application's read fails.
  await expect(drawer).not.toBeVisible();
  await expect(page.getByText(all.common.saved, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: all.verification.review, exact: true }).first().click();
  await expect(drawer.getByText('20260002', { exact: true })).toBeVisible();
  expect(reviewed).toEqual(['a1']);
  await drawer.getByRole('button', { name: all.verification.presets.blurry, exact: true }).click();
  await drawer.getByRole('button', { name: all.verification.supplement, exact: true }).click();
  await expect(drawer.getByText('20260003', { exact: true })).toBeVisible();
  expect(reviewed).toEqual(['a1', 'a2']);
  await fits(page, info);
});
