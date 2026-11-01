import example from '../../../../contracts/contribution.example.json';
import operations from '../../../../contracts/storage-operations.example.json';
import * as d from './data';

const realFetch = window.fetch.bind(window);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const nope = (code: string, status: number) => json({ code, request_id: 'demo' }, status);
void example;

const statusOf = (r: Record<string, any>) => r.state;
const entries: Record<string, any>[] = (d.reviews as Record<string, any>[]).map((r) => ({ id: r.id, root_id: r.root_id, school_id: r.school_id, input: { kind: r.kind, target_id: r.target_id, ...(r.term_id ? { term_id: r.term_id } : {}), ...(r.teacher_id ? { teacher_id: r.teacher_id } : {}), title: r.title, body: r.body, ratings: r.ratings, signed: !r.author.anonymous }, author_handle: r.author.handle, anonymous: r.author.anonymous, state: statusOf(r), revision: 1, created_at: r.published_at, published_at: r.published_at, featured: !!r.featured }));
const task = (id: string, object_id: string, kind: string, reason: string, content_kind: string, state = 'waiting', days = 1) => ({ id, school_id: d.SCHOOL, content_kind, submission: { object_id, kind, reason, evidence: [] as string[] }, object_revision: 1, revision: 1, state, created_at: d.ago(days), updated_at: d.ago(days), can_appeal: false });
const tasks: Record<string, any>[] = [
  task('m1', 'r13', 'report', '评价内容涉及人身攻击', 'review', 'waiting', 0),
  task('m2', 'r7', 'review', 'content_review', 'review', 'waiting', 0),
  task('m3', 'r5', 'edit_request', '想修改评价中的错别字', 'review', 'waiting', 1),
  task('m4', 'r11', 'appeal', '我认为隐藏决定有误，内容属实', 'review', 'waiting', 2),
  task('m5', 'x8:x8-v1', 'review', 'content_review', 'resource', 'waiting', 0),
  task('m6', 'x4:x4-v1', 'report', '疑似未经授权转载', 'resource', 'waiting', 1),
  task('m7', 'r2', 'report', '广告内容', 'review', 'failed', 3),
];
const policies: Record<string, any> = {};
const application = (id: string, state: string, stage: string, days: number) => ({ ...d.verification.application, id, state, stage, created_at: d.ago(days), updated_at: d.ago(days) });
const applications = [application('a1', 'pending_review', 'bachelor', 0), application('a2', 'pending_review', 'master', 1), application('a3', 'supplement_required', 'bachelor', 3), application('a4', 'approved', 'doctor', 8)];

function catalog(u: URL) {
  const q = u.searchParams;
  let items = [...(d.catalogByKind[q.get('kind') ?? ''] ?? [])] as Record<string, any>[];
  const text = (q.get('q') ?? '').trim();
  if (text) items = items.filter((o) => String(o.name).includes(text) || String(o.code ?? '').includes(text));
  for (const key of ['department_id', 'course_id', 'term_id', 'term_course_id', 'class_id']) {
    const value = q.get(key);
    if (value) items = items.filter((o) => o[key] === value);
  }
  const limit = Number(q.get('limit') || 20);
  const start = Number(q.get('after') || 0);
  return json({ items: items.slice(start, start + limit), next: start + limit < items.length ? String(start + limit) : '' });
}

async function body(init?: RequestInit) {
  try { return JSON.parse(String(init?.body ?? '{}')) as Record<string, any>; } catch { return {}; }
}

async function route(u: URL, method: string, init?: RequestInit): Promise<Response> {
  const p = u.pathname.replace('/api/v1', '');
  if (p === '/auth/session') return json({ authenticated: true, profile: { nickname: '运营值班', revision: 1 }, csrf_token: 'a'.repeat(43), phone_bound: true, administrator: true, expires_at: '2030-01-01T00:00:00Z' });
  if (p === '/auth/logout' || p === '/auth/logout-all') return new Response(null, { status: 204 });
  if (p === '/profiles/me') return json({ nickname: '运营值班', revision: 1 });
  if (p === '/system/capabilities') return json({ api_version: 1, capabilities: ['platform.status'] });
  if (p === '/admin/modules') return json([['session', 'ready', 'available'], ['catalog', 'ready', 'available'], ['reviews', 'ready', 'available'], ['resources', 'ready', 'available'], ['verification', 'ready', 'available'], ['storage', 'ready', 'available'], ['qqbot', 'disabled', 'disabled']].map(([id, state, health]) => ({ id, state, health })));

  if (p === '/catalog/objects') return catalog(u);
  if (p === '/catalog/objects/lookup') { const ids = (u.searchParams.get('ids') ?? '').split(','); const items = d.allObjects.filter((o) => ids.includes(o.id)); return json({ items, missing_ids: ids.filter((id) => !items.some((o) => o.id === id)) }); }
  if (p.startsWith('/catalog/objects/')) { const o = d.allObjects.find((x) => x.id === decodeURIComponent(p.split('/')[3]!)); return o ? json(o) : nope('not_found', 404); }

  if (p === '/moderation/tasks' && method === 'GET') {
    const q = u.searchParams;
    return json(tasks.filter((row) => (!q.get('state') || row.state === q.get('state')) && (!q.get('content_kind') || row.content_kind === q.get('content_kind'))));
  }
  if (p === '/moderation/tasks/batch-preview') return json({ preview_token: 'demo', items: [] });
  if (p === '/moderation/tasks/batch') return json({ items: [] });
  if (p.startsWith('/moderation/tasks/')) {
    const row = tasks.find((x) => x.id === p.split('/')[3]);
    if (!row) return nope('not_found', 404);
    if (p.endsWith('/decisions')) { row.state = 'decided'; row.revision++; return json(row); }
    return json(row);
  }
  if (p === '/moderation/policies' && method === 'GET') {
    const kind = u.searchParams.get('kind') ?? 'course';
    const effective = policies[kind] ?? { school_id: d.SCHOOL, kind, mode: kind === 'resource' ? 'pending' : 'published', blocked_terms: ['代写', '刷分'], revision: 1 };
    return json({ configured: policies[kind] ?? null, effective, source: policies[kind] ? 'school' : 'default' });
  }
  if (p === '/moderation/policies') { const b = await body(init); policies[b.kind] = { ...b, revision: (b.revision ?? 0) + 1 }; return json({ id: b.kind, revision: policies[b.kind].revision, state: 'saved' }); }

  if (p === '/reviews/admin/entries') return json({ items: entries.filter((row) => !u.searchParams.get('state') || row.state === u.searchParams.get('state')), next: '' });
  if (p.startsWith('/reviews/admin/entries/')) {
    const row = entries.find((x) => x.id === p.split('/')[4]);
    if (!row) return nope('not_found', 404);
    if (p.endsWith('/history')) return json([row]);
    if (p.endsWith('/attribution')) return json({ id: row.id, author_handle: row.author_handle, anonymous: row.anonymous });
    return json(row);
  }
  if (p === '/reviews/admin/presentation' || p === '/reviews/presentation') return json({ effective: { school_id: d.SCHOOL, revision: 1, guest_preview: 80, member_preview: 400, preview_ratio: 0.3, rating_texts: {} }, configured: null, source: 'default' });

  if (p === '/resources/capabilities') return json(d.capabilities);
  if (p === '/resources/categories') return json({ items: d.resCategories, next_cursor: '' });
  if (p.startsWith('/resources/categories/')) return json(d.resCategories.find((c) => c.id === p.split('/')[3]) ?? d.resCategories[0]);
  if (p === '/resources/directories') return json({ items: d.directories, next_cursor: '' });
  if (p.startsWith('/resources/directories/')) return json(d.directories[0]);
  if (p === '/resources/manage' || p === '/resources') return json({ items: d.resources, next_cursor: '' });
  if (p === '/resources/requests') return json({ items: d.receipts, next_cursor: '' });
  if (p.startsWith('/resources/review/')) { const id = decodeURIComponent(p.split('/')[3]!).split(':')[0]!.replace('-v1', ''); const row = d.resources.find((r) => r.id === id) ?? d.resources[0]!; return json({ resource: row, version: row.current ?? row.proposal }); }
  if (p.endsWith('/grants')) return json({ items: [], next_cursor: '' });
  if (p.startsWith('/resources/items/')) { const row = d.resources.find((r) => r.id === p.split('/')[3]); return row ? json(row) : nope('not_found', 404); }

  if (p === '/verification/schools') return json([d.verification.school]);
  if (p === '/admin/verification/access') return json({ allowed: true });
  if (p.startsWith('/admin/verification/schools/') && p.endsWith('/applications')) return json(applications);
  if (p.startsWith('/admin/verification/schools/') && p.endsWith('/requests')) return json([{ id: 'rv1', credential_id: 'cred', school_id: d.SCHOOL, kind: 'revoke', state: 'pending', reason: '同学申请注销认证', note: '', revision: 1, created_at: d.ago(2) }]);
  if (p.startsWith('/admin/verification/schools/')) return json(d.verification.school);
  if (p.startsWith('/admin/verification/jobs')) return json([{ id: 'job1', school_id: d.SCHOOL, kind: 'mail', state: 'manual', attempts: 3, code: 'mail_rejected' }]);
  if (p === '/admin/verification/suggestions') return json([]);
  if (p.startsWith('/admin/verification/credentials/')) return json(d.verification.credential('active'));

  if (p.startsWith('/storage/operations')) return json(operations);
  if (p.startsWith('/storage-contributions')) {
    if (p.endsWith('/policy')) return json(d.contribution.policy);
    if (p.endsWith('/statistics')) return json(d.contribution.statistics);
    if (p.endsWith('/options')) return json(d.contribution.options);
    if (method === 'GET') return json({ items: [d.contribution.item], next_cursor: '' });
    return json(d.contribution.item, 202);
  }
  if (p.startsWith('/storage/custody')) {
    if (p.endsWith('/policy')) return json(d.custody.policy);
    if (method === 'GET') return json({ items: d.custody.items, next_cursor: '' });
    return json(d.custody.items[0], 202);
  }
  return nope('not_found', 404);
}

export function installDemoFetch() {
  window.fetch = async (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (!u.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 150));
    const response = await route(u, method, init);
    if (response.status >= 400) console.warn('[demo]', method, u.pathname, response.status);
    return response;
  };
}
