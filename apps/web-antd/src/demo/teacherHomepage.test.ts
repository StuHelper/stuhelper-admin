import type { HomepageSchema } from './teacherHomepageData';

import { webcrypto } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import catalogContract from '../../../../contracts/catalog.openapi.json';
import { schemaOf } from '../shared/api/schema';
import { DemoTeacherHomepage } from './teacherHomepage';
import {
  makePhotoBytes,
  requestPortrait,
  sourcePortrait,
} from './teacherHomepageData';

const schemas = catalogContract.components.schemas;
const siteId = `site-${'a'.repeat(64)}`;
const siteDecision = `/review/sites/${siteId}/decision`;

function fixture() {
  const demo = new DemoTeacherHomepage();
  async function request(path: string, method: string, init?: RequestInit) {
    const url = new URL(
      `http://localhost/catalog/admin/schools/beihang/teacher-sites${path}`,
    );
    const result = await demo.handle(
      url.pathname,
      url.searchParams,
      method,
      init,
    );
    if (!result) throw new Error(`Missing demo route: ${method} ${path}`);
    return result;
  }
  return {
    demo,
    get: (path: string) => request(path, 'GET'),
    put: (path: string, body: unknown, key = 'demo-write') =>
      request(path, 'PUT', {
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
  };
}

async function parse<Name extends keyof HomepageSchema>(
  name: Name,
  response: Response,
) {
  expect(response.status).toBe(200);
  return schemaOf<HomepageSchema[Name]>(schemas, name)(await response.json());
}

describe('teacher homepage demo', () => {
  it('paginates the two candidate lists and invalidates a stale cursor after matching', async () => {
    const { get, put } = fixture();
    const first = await parse(
      'TeacherHomepageReviewSitePage',
      await get('/review/sites?limit=1'),
    );
    expect(first).toMatchObject({
      items: [{ site_id: siteId, candidates: [{ teacher_id: 'p2' }] }],
      total: 3,
      next: expect.any(String),
    });
    const page2 = await parse(
      'TeacherHomepageReviewSitePage',
      await get(
        `/review/sites?limit=1&after=${encodeURIComponent(first.next)}`,
      ),
    );
    expect(page2.items[0]?.site_id).not.toBe(siteId);

    const teachers = await parse(
      'TeacherHomepageReviewTeacherPage',
      await get('/review/teachers?q=p2'),
    );
    expect(teachers.items).toMatchObject([
      { teacher_id: 'p2', candidates: [{ site_id: siteId }] },
    ]);
    const decision = { action: 'bind', teacher_id: 'p2', expected_revision: 0 };
    const saved = await parse(
      'TeacherHomepageDecisionResult',
      await put(siteDecision, decision),
    );
    expect(saved).toEqual({
      site_id: siteId,
      decision_revision: 1,
      decision: { action: 'bind', teacher_id: 'p2' },
    });
    expect(
      await parse(
        'TeacherHomepageDecisionResult',
        await put(siteDecision, decision),
      ),
    ).toEqual(saved);
    const wrongKey = await put(siteDecision, {
      action: 'reject',
      expected_revision: 1,
    });
    expect(wrongKey.status).toBe(409);
    const stalePage = await get(
      `/review/sites?limit=1&after=${encodeURIComponent(first.next)}`,
    );
    expect(stalePage.status).toBe(409);
    const counts = await parse(
      'TeacherHomepageCounts',
      await get('/homepage-counts'),
    );
    expect(counts).toEqual({
      teaching: 10,
      official: 3,
      both: 3,
      eligible: 10,
      verified_homepage: 1,
    });
    const revoked = await parse(
      'TeacherHomepageDecisionResult',
      await put(
        siteDecision,
        { action: 'revoke', expected_revision: 1 },
        'revoke',
      ),
    );
    expect(revoked).toEqual({ site_id: siteId, decision_revision: 2 });
  });

  it('edits the school allowlist with revision checks and denies other schools', async () => {
    const { demo, get, put } = fixture();
    const initial = await parse(
      'TeacherHomepageAllowlist',
      await get('/allowlist'),
    );
    const fields = [{ field: 'sections', label: '教学工作' }];
    const invalid = await put('/allowlist', {
      expected_revision: initial.revision,
      fields: [...fields, { field: 'sections', label: '教学工作：' }],
    });
    expect(invalid.status).toBe(400);
    const saved = await parse(
      'TeacherHomepageAllowlist',
      await put('/allowlist', { expected_revision: initial.revision, fields }),
    );
    expect(saved).toEqual({ revision: initial.revision + 1, fields });
    const stale = await put(
      '/allowlist',
      { expected_revision: initial.revision, fields: [] },
      'stale',
    );
    expect(stale.status).toBe(409);
    expect(
      await parse('TeacherHomepageAllowlist', await get('/allowlist')),
    ).toEqual(saved);

    const denied = await demo.handle(
      '/catalog/admin/schools/another-school/teacher-sites/requests/th-demo-photo/photo',
      new URLSearchParams(),
      'GET',
    );
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toMatchObject({ code: 'forbidden' });
  });

  it('reuses a private avatar, revokes it while hidden and returns a capacity conflict atomically', async () => {
    const { demo, get, put } = fixture();
    const path = '/teachers/p1/homepage';
    const initial = await parse('TeacherHomepageControlsView', await get(path));
    expect(initial.source?.name).toBe('林知远');
    expect(initial.controls.rules[0]?.override?.photo).toEqual(sourcePortrait);
    const photoPath = `/catalog/objects/p1/teacher-homepage/photos/${sourcePortrait.id}`;
    const photo = await demo.handle(photoPath, new URLSearchParams(), 'GET');
    expect(photo?.status).toBe(200);
    expect(photo?.headers.get('Content-Type')).toBe('image/png');
    expect(photo?.headers.get('Cache-Control')).toBe('private, no-store');

    const rules = [
      {
        field: { field: 'photo' },
        hidden: false,
        override: { photo: { id: sourcePortrait.id } },
      },
    ];
    await parse(
      'TeacherHomepageControlsReceipt',
      await put(path, {
        expected_revision: initial.controls.revision,
        page_visibility: 'hidden',
        rules,
      }),
    );
    const hiddenPhoto = await demo.handle(
      photoPath,
      new URLSearchParams(),
      'GET',
    );
    expect(hiddenPhoto?.status).toBe(404);
    const overflow = await put(
      path,
      {
        expected_revision: 2,
        page_visibility: 'visible',
        rules: Array.from({ length: 65 }, (_, index) => ({
          field: { field: 'sections', label: `Section ${index}` },
          hidden: false,
          override: { text: 'Content' },
        })),
      },
      'overflow',
    );
    expect(overflow.status).toBe(409);
    expect(await overflow.json()).toMatchObject({
      code: 'teacher_homepage_capacity_exceeded',
    });
    const reloaded = await parse(
      'TeacherHomepageControlsView',
      await get(path),
    );
    expect(reloaded.controls).toMatchObject({
      revision: 2,
      page_visibility: 'hidden',
      rules: [{ override: { photo: sourcePortrait } }],
    });
  });

  it('returns the checked image as a private binary response after an avatar upload', async () => {
    const { demo, put } = fixture();
    const data = makePhotoBytes().get(requestPortrait.id);
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', async () => ({
      close,
      height: 64,
      width: 64,
    }));
    vi.stubGlobal('crypto', webcrypto);
    try {
      await parse(
        'TeacherHomepageControlsReceipt',
        await put('/teachers/p1/homepage', {
          expected_revision: 1,
          page_visibility: 'visible',
          rules: [
            {
              field: { field: 'photo' },
              hidden: false,
              override: {
                photo: { content_type: requestPortrait.content_type, data },
              },
            },
          ],
        }),
      );
      const url = `/catalog/objects/p1/teacher-homepage/photos/${requestPortrait.id}`;
      const photo = await demo.handle(url, new URLSearchParams(), 'GET');
      expect(photo?.status).toBe(200);
      const body = await photo?.arrayBuffer();
      expect(body?.byteLength).toBeGreaterThan(8);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reviews teacher requests against both revisions and applies the approved photo once', async () => {
    const { demo, get, put } = fixture();
    const firstPage = await parse(
      'TeacherHomepageRequestPage',
      await get('/requests?limit=1'),
    );
    const list = await parse(
      'TeacherHomepageRequestPage',
      await get('/requests?status=pending&teacher_id=p2'),
    );
    expect(list.items).toMatchObject([{ id: 'th-demo-photo', revision: 1 }]);
    const path = '/requests/th-demo-photo';
    const initial = await parse('TeacherHomepageRequest', await get(path));
    expect(initial.value?.photo).toEqual(requestPortrait);
    const photo = await get(`${path}/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Cache-Control')).toBe('private, no-store');

    const approval = {
      action: 'approve',
      expected_revision: 1,
      expected_homepage_revision: 0,
      note: 'Photo checked',
    };
    const stale = await put(
      `${path}/decision`,
      { ...approval, expected_homepage_revision: 1 },
      'stale',
    );
    expect(stale.status).toBe(409);
    const pending = await parse('TeacherHomepageRequest', await get(path));
    expect(pending.status).toBe('pending');
    expect(demo.target('beihang', 'p2')?.visible).toBe(false);

    const approved = await parse(
      'TeacherHomepageRequest',
      await put(`${path}/decision`, approval),
    );
    expect(approved).toMatchObject({
      status: 'approved',
      resolution_note: 'Photo checked',
      revision: 2,
    });
    expect(
      await parse(
        'TeacherHomepageRequest',
        await put(`${path}/decision`, approval),
      ),
    ).toEqual(approved);
    const nextPage = await parse(
      'TeacherHomepageRequestPage',
      await get(
        `/requests?limit=1&after=${encodeURIComponent(firstPage.next)}`,
      ),
    );
    expect(nextPage.items).toMatchObject([{ id: 'th-demo-research' }]);
    const controls = await parse(
      'TeacherHomepageControlsView',
      await get('/teachers/p2/homepage'),
    );
    expect(controls.controls).toMatchObject({
      rules: [{ override: { photo: requestPortrait } }],
      independent: true,
      revision: 1,
    });
    expect(demo.target('beihang', 'p2')).toMatchObject({ visible: true });
    const counts = await parse(
      'TeacherHomepageCounts',
      await get('/homepage-counts'),
    );
    expect(counts).toMatchObject({
      verified_homepage: 2,
      official: 2,
      eligible: 10,
    });
  });

  it('rejects a request and preserves the homepage revision', async () => {
    const { get, put } = fixture();
    const path = '/requests/th-demo-hide';
    const note = 'Please provide the record to update';
    const rejected = await parse(
      'TeacherHomepageRequest',
      await put(`${path}/decision`, {
        action: 'reject',
        expected_revision: 1,
        note,
      }),
    );
    expect(rejected).toMatchObject({
      status: 'rejected',
      resolution_note: note,
      revision: 2,
    });
    const controls = await parse(
      'TeacherHomepageControlsView',
      await get('/teachers/p1/homepage'),
    );
    expect(controls.controls).toMatchObject({
      page_visibility: 'visible',
      revision: 1,
    });
  });

  it('checks the effective teacher homepage revision before hiding a complaint target', async () => {
    const { demo, get, put } = fixture();
    const before = demo.target('beihang', 'p3');
    expect(before).toEqual({ revision: 1, visible: true });
    await parse(
      'TeacherHomepageControlsReceipt',
      await put('/teachers/p3/homepage', {
        expected_revision: 0,
        page_visibility: 'visible',
        rules: [],
      }),
    );
    expect(demo.hideTarget('beihang', 'p3', 1)).toBe('conflict');
    const updated = demo.target('beihang', 'p3');
    expect(updated?.revision).toBeGreaterThan(1);
    expect(demo.hideTarget('beihang', 'p3', updated!.revision)).toBe('ok');
    expect(demo.target('beihang', 'p3')?.visible).toBe(false);
    const controls = await parse(
      'TeacherHomepageControlsView',
      await get('/teachers/p3/homepage'),
    );
    expect(controls.controls).toMatchObject({
      page_visibility: 'hidden',
      revision: 2,
    });
  });
});
