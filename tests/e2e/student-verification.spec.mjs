import { Buffer } from 'node:buffer';
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
function fill(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}
const base = 'http://127.0.0.1:18786';

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
const application = {
  id: 'app-1',
  school_id: 'school',
  method: 'manual_material_review',
  stage: 'bachelor',
  kind: 'student',
  state: 'pending_review',
  revision: 3,
  created_at: '2026-11-10T00:00:00Z',
  updated_at: '2026-11-11T00:00:00Z',
  expires_at: '2026-12-10T00:00:00Z',
  credential_id: '',
  result_code: '',
};
const manualForm = {
  student_id: '2026010999',
  name: 'Zhang San',
  department: 'School of CS',
  email: 'zs@demo.edu',
  material_type: 'student_card',
  material_ids: ['mat-1'],
  revision: 3,
};
const materialMeta = {
  id: 'mat-1',
  application_id: 'app-1',
  content_type: 'image/png',
  size: 68,
  created_at: '2026-11-10T00:00:00Z',
};
const credential = {
  id: 'cred-1',
  school_id: 'school',
  method: 'manual_material_review',
  stage: 'bachelor',
  kind: 'student',
  state: 'active',
  student_display: '2026****99',
  revision: 2,
  verified_at: '2026-11-01T00:00:00Z',
  expires_at: '2027-07-01T00:00:00Z',
};
const profile = {
  school_id: 'school',
  data_status: 'partial',
  schema: 'v1',
  revision: 1,
  collected_at: '2026-11-01T00:00:00Z',
  source_revision: 's1',
  fields: { department: 'School of CS' },
  field_sources: { department: 'manual' },
};
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('student verification reviews manual materials and clears private materials immediately on permission revocation', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const v = all.verification;
  let revoked = false;
  const writes = [];

  await page.route('**/api/v1/**verification/**', (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() === 'GET') {
      if (p === '/api/v1/admin/verification/access') {
        return route.fulfill({ json: { allowed: true } });
      }
      if (p === '/api/v1/verification/schools') {
        return route.fulfill({ json: [school] });
      }
      if (p === '/api/v1/admin/verification/schools/school/applications') {
        return route.fulfill({ json: [application] });
      }
      if (p === '/api/v1/admin/verification/applications/app-1/form') {
        return route.fulfill({ json: manualForm });
      }
      if (p === '/api/v1/verification/applications/app-1/materials') {
        return route.fulfill({ json: [materialMeta] });
      }
      if (p === '/api/v1/verification/materials/mat-1') {
        return route.fulfill({ body: pixel, contentType: 'image/png' });
      }
      return route.fulfill({ status: 404, json: { code: 'not_found' } });
    }
    if (revoked) {
      return route.fulfill({
        status: 403,
        json: { code: 'verification_forbidden', request_id: 'req-v1' },
      });
    }
    const body = req.postDataJSON();
    writes.push({ path: p, body, key: req.headers()['idempotency-key'] });
    return route.fulfill({
      json: { ...application, state: 'approved', revision: 4 },
    });
  });

  await page.goto(`${base}/verification?lang=${info.project.metadata.locale}`);
  await expect(page.locator('html')).toHaveAttribute(
    'dir',
    info.project.metadata.locale === 'ar-EG' ? 'rtl' : 'ltr',
  );
  await page.getByRole('button', { name: v.review, exact: true }).click();
  const drawer = page.locator('.ant-drawer-content');
  await expect(drawer.getByText('2026010999', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Zhang San', { exact: true })).toBeVisible();
  await expect(
    drawer.getByRole('img', { name: fill(v.material, { index: '1' }) }),
  ).toBeVisible();

  // Revoke permission before approving: private student ID, name, and photo disappear at once.
  revoked = true;
  await drawer.getByRole('button', { name: v.approve, exact: true }).click();
  await expect(page.getByText('2026010999', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Zhang San', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('img', { name: fill(v.material, { index: '1' }) }),
  ).toHaveCount(0);
});

test('student credential lookup loads profile scopes on demand and revokes with a note', async ({
  page,
}, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const v = all.verification;
  const writes = [];

  await page.route('**/api/v1/**verification/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    if (req.method() === 'GET') {
      if (p === '/api/v1/admin/verification/access') {
        return route.fulfill({ json: { allowed: true } });
      }
      if (p === '/api/v1/verification/schools') {
        return route.fulfill({ json: [school] });
      }
      if (p === '/api/v1/admin/verification/schools/school/applications') {
        return route.fulfill({ json: [] });
      }
      if (p === '/api/v1/admin/verification/credentials/cred-1') {
        return route.fulfill({ json: credential });
      }
      if (p === '/api/v1/admin/verification/credentials/cred-1/profile') {
        return route.fulfill({ json: profile });
      }
      return route.fulfill({ status: 404, json: { code: 'not_found' } });
    }
    const body = req.postDataJSON();
    writes.push({ path: p, body, key: req.headers()['idempotency-key'] });
    return route.fulfill({
      json: { ...credential, state: 'revoked', revision: 3 },
    });
  });

  await page.goto(`${base}/verification?lang=${info.project.metadata.locale}`);
  await expect(page.getByText(v.noApplications, { exact: true })).toBeVisible();
  const credTab = page.getByRole('tab', { name: v.tabs.credentials, exact: true });
  await credTab.click();
  if ((await credTab.getAttribute('aria-selected')) !== 'true') {
    await credTab.click();
  }
  await page.locator('#verificationview-field-3').fill('cred-1');
  await page
    .getByRole('button', { name: all.common.search, exact: true })
    .click();
  await expect(page.getByText('2026****99', { exact: true })).toBeVisible();

  await page
    .getByRole('button', { name: v.profileBasic, exact: true })
    .click();
  await expect(page.getByText('School of CS')).toBeVisible();

  await page.locator('#verificationview-field-4').fill('Withdrawn from school');
  await page.getByRole('button', { name: v.revoke, exact: true }).click();
  await expect(page.getByText(all.common.saved, { exact: true })).toBeVisible();
  expect(writes).toEqual([
    {
      path: '/api/v1/admin/verification/credentials/cred-1/revoke',
      key: expect.any(String),
      body: { approve: true, note: 'Withdrawn from school', revision: 2 },
    },
  ]);
});

test('school data authorization displays the retained term for a credential', async ({ page }, info) => {
  await schoolSession(page);
  const all = catalogue(info);
  const v = all.verification;
  const schoolID = '4111010006';
  const locale = info.project.metadata.locale;
  const replies = {
    '/api/v1/admin/verification/access': { allowed: true },
    '/api/v1/verification/schools': [{ ...school, id: schoolID }],
    [`/api/v1/admin/verification/schools/${schoolID}/applications`]: [],
    '/api/v1/admin/verification/credentials/cred-1': { ...credential, school_id: schoolID },
    '/api/v1/admin/verification/credentials/cred-1/school-data': {
      authorized_through: { id: 'autumn-26', season: 'autumn', year: 2026 },
      state: 'historical',
    },
  };
  await page.route('**/api/v1/**verification/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return Object.hasOwn(replies, path)
      ? route.fulfill({ json: replies[path] })
      : route.fulfill({ status: 404, json: { code: 'not_found' } });
  });
  await page.goto(`${base}/verification?lang=${locale}`);
  await expect(page.getByText(v.noApplications, { exact: true })).toBeVisible();
  const credTab = page.getByRole('tab', { name: v.tabs.credentials, exact: true });
  await credTab.click();
  if ((await credTab.getAttribute('aria-selected')) !== 'true') {
    await credTab.click();
  }
  await expect(credTab).toHaveAttribute('aria-selected', 'true');
  await page.locator('#verificationview-field-3').fill('cred-1');
  await page.getByRole('button', { name: all.common.search, exact: true }).click();
  await expect(page.getByText(v.schoolData.states.historical, { exact: true })).toBeVisible();
  const term = fill(v.schoolData.term, {
    season: v.schoolData.seasons.autumn,
    year: new Intl.NumberFormat(locale, { useGrouping: false }).format(2026),
  });
  await expect(page.getByText(term, { exact: true })).toBeVisible();
});
