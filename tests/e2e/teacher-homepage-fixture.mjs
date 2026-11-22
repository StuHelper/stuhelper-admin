import { Buffer } from 'node:buffer';

import { cdn } from '../teacher-media-fixture.mjs';

export const teacher = {
  teacher_id: 'teacher-1',
  name: 'Lin Zhiyuan',
  department: 'Computer Science',
  title: 'Professor',
};
export const secondTeacher = {
  teacher_id: 'teacher-2',
  name: 'Zhou Qinghe',
  department: 'Mathematics',
  title: 'Associate Professor',
};
export const siteSummary = {
  site_id: 'site-' + 'a'.repeat(64),
  name: 'Lin Zhiyuan (official)',
  unit: 'School of Computing',
  present: true,
};
export const secondSite = {
  site_id: 'site-' + 'b'.repeat(64),
  name: 'Zhou Qinghe (official)',
  unit: 'School of Mathematics',
  present: true,
};

export const existingSection = 'Publications';
export const fieldLabel = 'Laboratory website';
export const createdAt = '2026-11-20T00:00:00Z';
export const counts = {
  teaching: 125,
  official: 189,
  both: 72,
  eligible: 255,
  verified_homepage: 31,
};
export const portrait = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNQqTiAFTEMLQkA17dXAbSNuqIAAAAASUVORK5CYII=',
  'base64',
);

const profileRevision = 13;
const source = {
  name: siteSummary.name,
  position: 'Head of systems research',
  biography: 'Researches distributed systems and reliable computing.',
  supervisors: ['博士生导师'],
  fields: [{ label: fieldLabel, value: 'Systems laboratory' }],
  sections: [{ title: existingSection, text: 'Selected papers and talks.' }],
};
const portraitMetadata = {
  id: 'c'.repeat(64),
  content_type: 'image/png',
  width: 8,
  height: 8,
};
export const photoRequest = {
  id: 'request-portrait',
  teacher_id: teacher.teacher_id,
  kind: 'correction',
  field: { field: 'photo' },
  value: { photo: portraitMetadata },
  message: 'Please replace the archived faculty portrait.',
  status: 'pending',
  revision: 3,
  created_at: createdAt,
};
export const textRequest = {
  id: 'request-research',
  teacher_id: secondTeacher.teacher_id,
  kind: 'supplement',
  field: { field: 'research' },
  value: { text: 'Algebraic geometry and representation theory.' },
  message: 'Please publish my current research areas.',
  status: 'pending',
  revision: 7,
  created_at: createdAt,
};

function fail(route, status, code) {
  return route.fulfill({ status, json: { code } });
}

function pageResult(items, next = '', total = items.length) {
  return { items, next, total };
}

function searchable(rows, query) {
  if (!query) return rows;
  return rows.filter((row) =>
    [row.name, row.unit, row.department, row.site_id, row.teacher_id]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query.toLowerCase())),
  );
}

export async function teacherHomepageFixture(page, failures = {}) {
  const calls = [];
  let siteRevision = 2;
  let decision;
  const siteReceipts = new Map();
  let allowlist = {
    fields: [{ field: 'position' }, { field: 'sections', label: existingSection }],
    revision: 4,
  };
  let controls = {
    page_visibility: 'visible',
    independent: false,
    rules: [],
    revision: profileRevision,
  };
  const requests = [structuredClone(photoRequest), structuredClone(textRequest)];

  const teachers = [teacher, secondTeacher].map((item) => ({
    id: item.teacher_id,
    name: item.name,
    kind: 'teacher',
    school_id: 'school',
    credits: null,
    revision: 1,
    updated_at: createdAt,
    aliases: [],
  }));
  await page.route('**/api/v1/catalog/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/objects/lookup')) {
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
      const items = teachers.filter(({ id }) => ids.includes(id));
      return route.fulfill({ json: {
        items,
        missing_ids: ids.filter((id) => !items.some((item) => item.id === id)),
      } });
    }
    if (url.pathname.endsWith('/objects')) {
      const items = url.searchParams.get('kind') === 'teacher'
        ? searchable(teachers, url.searchParams.get('q'))
        : [];
      return route.fulfill({ json: { items, next: '' } });
    }
    if (url.pathname.endsWith(`/teacher-homepage/photos/${portraitMetadata.id}`)) {
      if (controls.page_visibility !== 'visible') return fail(route, 404, 'not_found');
      return route.fulfill({
        status: 302, headers: { location: cdn + '/manual-portrait', 'cache-control': 'private, no-store' },
      });
    }
    return route.fallback();
  });

  await page.route('**/api/v1/catalog/admin/schools/*/teacher-sites/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const [, school, path] = /\/schools\/([^/]+)\/teacher-sites(\/.*)$/.exec(url.pathname);
    const query = Object.fromEntries(url.searchParams);
    const method = req.method();
    const key = req.headers()['idempotency-key'];
    const body = method === 'PUT' ? req.postDataJSON() : undefined;
    calls.push({ school, path, method, query, key, body });
    if (school !== 'school' || failures.permission === 'denied') {
      return fail(route, 403, 'forbidden');
    }
    if (failures.permission === 'readonly' && path !== '/review/sites' && path !== '/review/teachers') {
      return fail(route, 403, 'forbidden');
    }
    if (path === '/review/sites') {
      if (failures.sitesOnce) {
        failures.sitesOnce = false;
        return fail(route, 503, 'unavailable');
      }
      const rows = searchable([
        {
          ...siteSummary,
          reason: 'unit_mismatch',
          biography_excerpt: source.biography,
          candidates: [teacher],
          candidate_count: 1,
          decision_revision: siteRevision,
          ...(decision && { decision }),
        },
        {
          ...secondSite,
          candidates: [],
          candidate_count: 0,
          decision_revision: 0,
          reason: 'name_absent',
        },
      ], query.q).filter((row) =>
        query.status === 'all' || (query.status === 'decided' ? row.decision : !row.decision),
      );
      const offset = query.after === 'site-cursor-2' ? 1 : 0;
      return route.fulfill({
        json: pageResult(rows.slice(offset, offset + 1), rows.length > 1 && !offset ? 'site-cursor-2' : '', rows.length),
      });
    }
    if (path === '/review/teachers') {
      const rows = searchable([
        { ...teacher, candidates: [siteSummary], candidate_count: 1 },
        { ...secondTeacher, candidates: [secondSite], candidate_count: 1 },
      ], query.q);
      const offset = query.after === 'teacher-cursor-2' ? 1 : 0;
      return route.fulfill({
        json: pageResult(rows.slice(offset, offset + 1), rows.length > 1 && !offset ? 'teacher-cursor-2' : '', rows.length),
      });
    }
    if (path === `/review/sites/${siteSummary.site_id}/decision`) {
      if (siteReceipts.has(key)) return route.fulfill({ json: siteReceipts.get(key) });
      if (body.action === 'bind' && failures.matchConflict) {
        failures.matchConflict = false;
        siteRevision += 1;
        return fail(route, 409, 'conflict');
      }
      if (body.expected_revision !== siteRevision) return fail(route, 409, 'conflict');
      siteRevision += 1;
      decision = body.action === 'revoke' ? undefined : {
        action: body.action,
        ...(body.action === 'bind' && { teacher_id: body.teacher_id }),
      };
      const receipt = { site_id: siteSummary.site_id, decision_revision: siteRevision, decision };
      siteReceipts.set(key, receipt);
      if (body.action === 'reject' && failures.matchTimeout) {
        failures.matchTimeout = false;
        return fail(route, 504, 'timeout');
      }
      return route.fulfill({ json: receipt });
    }
    if (path === '/homepage-counts') return route.fulfill({ json: counts });
    if (path === '/allowlist') {
      if (method === 'GET') return route.fulfill({ json: allowlist });
      if (failures.allowlistConflict) {
        failures.allowlistConflict = false;
        allowlist = { revision: 5, fields: [...allowlist.fields, { field: 'degree' }] };
        return fail(route, 409, 'conflict');
      }
      if (body.expected_revision !== allowlist.revision) return fail(route, 409, 'conflict');
      allowlist = { revision: allowlist.revision + 1, fields: body.fields };
      return route.fulfill({ json: allowlist });
    }
    if (path === `/teachers/${teacher.teacher_id}/homepage`) {
      if (method === 'GET') return route.fulfill({ json: { source, controls } });
      if (failures.capacity) {
        failures.capacity = false;
        return fail(route, 409, 'teacher_homepage_capacity_exceeded');
      }
      if (body.expected_revision !== controls.revision) return fail(route, 409, 'conflict');
      const rules = body.rules.map((rule) => rule.override?.photo
        ? { ...rule, override: { photo: portraitMetadata } }
        : rule);
      controls = { ...controls, page_visibility: body.page_visibility, revision: controls.revision + 1, rules };
      return route.fulfill({ json: { teacher_id: teacher.teacher_id, revision: controls.revision } });
    }
    if (method === 'GET' && path === `/teachers/${secondTeacher.teacher_id}/homepage`) {
      return route.fulfill({ json: {
        controls: { revision: 0, page_visibility: 'visible', independent: false, rules: [] },
      } });
    }
    if (path === '/requests') {
      const items = requests.filter((item) =>
        (!query.teacher_id || query.teacher_id === item.teacher_id)
        && (query.status === 'all' || (query.status || 'pending') === item.status),
      );
      const offset = query.after === 'request-cursor-2' ? 1 : 0;
      return route.fulfill({
        json: pageResult(items.slice(offset, offset + 1), items.length > 1 && !offset ? 'request-cursor-2' : '', items.length),
      });
    }
    const [, id, suffix] = /^\/requests\/([^/]+)(.*)$/.exec(path) ?? [];
    const item = requests.find((candidate) => candidate.id === id);
    if (!item) return fail(route, 404, 'not_found');
    if (suffix === '/photo' && item.value.photo) {
      if (failures.photoOnce) {
        failures.photoOnce = false;
        return fail(route, 503, 'unavailable');
      }
      return route.fulfill({
        status: 302, headers: { location: cdn + '/request-portrait', 'cache-control': 'private, no-store' },
      });
    }
    if (suffix === '') return route.fulfill({ json: item });
    if (suffix === '/decision') {
      if (body.action === 'approve' && failures.requestConflict) {
        failures.requestConflict = false;
        controls = { ...controls, revision: controls.revision + 1 };
        item.revision += 1;
        return fail(route, 409, 'conflict');
      }
      if (body.expected_revision !== item.revision
        || (body.action === 'approve' && body.expected_homepage_revision !== controls.revision)) {
        return fail(route, 409, 'conflict');
      }
      Object.assign(item, {
        revision: item.revision + 1,
        status: body.action === 'approve' ? 'approved' : 'rejected',
        resolved_at: createdAt,
        resolution_note: body.note,
      });
      return route.fulfill({ json: item });
    }
    return fail(route, 404, 'not_found');
  });

  return calls;
}
