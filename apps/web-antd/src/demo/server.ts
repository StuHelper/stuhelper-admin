import type { components as Moderation } from '../api/moderation.gen';

import example from '../../../../contracts/contribution.example.json';
import moderationContract from '../../../../contracts/moderation.openapi.json';
import operations from '../../../../contracts/storage-operations.example.json';
import { schemaOf } from '../shared/api/schema';
import { isValidModerationReason } from '../shared/ui/moderation-reason';
import * as d from './data';
import { createDemoLegalHandler } from './legal';
import {
  handleDemoTeacherHomepage,
  hideDemoTeacherHomepageTarget,
  readDemoTeacherHomepageTarget,
} from './teacherHomepage';

const json = (value: unknown, status = 200) => Response.json(value, { status });
const nope = (code: string, status: number) =>
  json({ code, request_id: 'demo' }, status);
void example;

const DEMO_CSRF_TOKEN = 'a'.repeat(43);
const handleLegalRequest = createDemoLegalHandler({ csrfToken: DEMO_CSRF_TOKEN });

const demoCapabilities = [
  'platform.status',
  'billing.manage', 'billing.commerce', 'billing.resource-price',
  'groups.read',
  'groups.manage',
  'groups.configure',
  'qq-binding.manage',
  'open-platform.manage',
  'information-query.query',
];

const statusOf = (r: Record<string, any>) => r.state;
const entries: Record<string, any>[] = (d.reviews as Record<string, any>[]).map(
  (r) => ({
    id: r.id,
    root_id: r.root_id,
    school_id: r.school_id,
    input: {
      kind: r.kind,
      target_id: r.target_id,
      ...(r.term_id ? { term_id: r.term_id } : {}),
      ...(r.teacher_ids ? { teacher_ids: r.teacher_ids } : {}),
      title: r.title,
      body: r.body,
      ratings: r.ratings,
      signed: !r.author.anonymous,
    },
    author_handle: r.author.handle,
    anonymous: r.author.anonymous,
    state: statusOf(r),
    revision: 1,
    created_at: r.published_at,
    published_at: r.published_at,
    featured: !!r.featured,
  }),
);

type TaskView = Moderation['schemas']['TaskView'];
type QueueSummary = Moderation['schemas']['QueueSummary'];
type DemoTask = TaskView & {
  content_kind: keyof QueueSummary['by_content_kind'];
};
type DemoTaskDecision = Moderation['schemas']['Decide'];
const moderationSchemas = moderationContract.components.schemas;
const parseDecide = schemaOf<DemoTaskDecision>(moderationSchemas, 'Decide');
const taskCategory = (row: TaskView) => row.decision?.category ?? row.submission.category;

const task = (
  id: string,
  object_id: string,
  kind: TaskView['submission']['kind'],
  reason: string,
  content_kind: DemoTask['content_kind'],
  state = 'waiting',
  days = 1,
  category?: TaskView['submission']['category'],
): DemoTask => ({
  id,
  school_id: d.SCHOOL,
  content_kind,
  submission: { object_id, kind, reason, evidence: [], ...(category ? { category } : {}) },
  object_revision: 1,
  revision: 1,
  state,
  created_at: d.ago(days),
  updated_at: d.ago(days),
  can_appeal: false,
});
const tasks = [
  task('m1', 'r13', 'report', '评价内容涉及人身攻击', 'course', 'waiting', 0, 'personal_attack'),
  task('m2', 'r7', 'review', 'content_review', 'course', 'waiting', 0),
  task('m3', 'r5', 'edit_request', '想修改评价中的错别字', 'course', 'waiting', 1),
  task('m4', 'r11', 'appeal', '我认为隐藏决定有误，内容属实', 'course', 'waiting', 2),
  task('m5', 'resource:x8-v1', 'review', 'content_review', 'resource', 'waiting', 0),
  task('m6', 'resource:x4-v1', 'report', '疑似未经授权转载', 'resource', 'waiting', 1, 'copyright'),
  task('m7', 'r2', 'report', '广告内容', 'course', 'failed', 3, 'spam'),
  task('m8', 'teacher-homepage:p3', 'report', '主页展示了不应公开的联系方式。', 'teacher_homepage', 'waiting', 1, 'privacy_leak'),
];
const complaintReplays = new Map<string, { body: string; result: DemoTask }>();
const policies: Record<string, any> = {};
const application = (id: string, state: string, stage: string, days: number) => ({
  ...d.verification.application,
  id,
  state,
  stage,
  created_at: d.ago(days),
  updated_at: d.ago(days),
});
const applications = [
  application('a1', 'pending_review', 'bachelor', 0),
  application('a2', 'pending_review', 'master', 1),
  application('a3', 'supplement_required', 'bachelor', 3),
  application('a4', 'approved', 'doctor', 8),
];

function moderationSummary(school: string, includeTeacherHomepage: boolean): QueueSummary {
  const summary: QueueSummary = {
    school_id: school,
    waiting: 0,
    decided: 0,
    failed: 0,
    by_content_kind: { course: 0, mentor: 0, reply: 0, resource: 0 },
    by_request_kind: { review: 0, report: 0, edit_request: 0, delete_request: 0, appeal: 0 },
    by_category: {},
  };
  for (const row of tasks) {
    if (row.school_id !== school || (row.content_kind === 'teacher_homepage' && !includeTeacherHomepage)) continue;
    if (row.state === 'decided') summary.decided++;
    if (row.state === 'failed') summary.failed++;
    if (row.state !== 'waiting') continue;
    summary.waiting++;
    summary.by_content_kind[row.content_kind] = (summary.by_content_kind[row.content_kind] ?? 0) + 1;
    summary.by_request_kind[row.submission.kind]++;
    const category = taskCategory(row);
    if (category) summary.by_category[category] = (summary.by_category[category] ?? 0) + 1;
  }
  return summary;
}

function demoCourseTeacherIds(course: string, term?: null | string) {
  if (term && !d.offerings.some((item) => item.id === `${course}-${term}`)) return [];
  return d.teachesIn.filter(([id]) => id === course).map(([, teacher]) => teacher);
}

function catalog(u: URL) {
  const q = u.searchParams;
  const teacherCourse = q.get('kind') === 'teacher' ? q.get('course_id') : null;
  let items = [
    ...(d.catalogByKind[q.get('kind') ?? ''] ?? []),
  ] as Record<string, any>[];
  if (teacherCourse) {
    const teachers = demoCourseTeacherIds(teacherCourse, q.get('term_id'));
    items = items.filter((item) => teachers.includes(item.id));
  }
  const text = (q.get('q') ?? '').trim();
  if (text) {
    items = items.filter(
      (o) => String(o.name).includes(text) || String(o.code ?? '').includes(text),
    );
  }
  for (const key of [
    'department_id',
    'course_id',
    'term_id',
    'term_course_id',
    'class_id',
  ]) {
    if (teacherCourse && (key === 'course_id' || key === 'term_id')) continue;
    const value = q.get(key);
    if (value) items = items.filter((o) => o[key] === value);
  }
  const limit = Number(q.get('limit') || 20);
  const start = Number(q.get('after') || 0);
  return json({
    items: items.slice(start, start + limit),
    next: start + limit < items.length ? String(start + limit) : '',
  });
}

async function body(init?: RequestInit) {
  try {
    return JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
  } catch {
    return {};
  }
}

function decideDemoTeacherComplaint(row: DemoTask, request: DemoTaskDecision, init?: RequestInit) {
  const key = new Headers(init?.headers).get('Idempotency-Key');
  if (!key) return nope('invalid_input', 400);
  const serialized = JSON.stringify(request);
  const replayKey = `${row.id}:${key}`;
  const replay = complaintReplays.get(replayKey);
  if (replay) return replay.body === serialized ? json(replay.result) : nope('conflict', 409);

  const { decision } = request;
  if (
    !['dismiss', 'hide'].includes(decision.action) ||
    decision.body !== undefined ||
    decision.teacher_ids !== undefined ||
    decision.subject ||
    decision.author_handle ||
    decision.evidence_revision ||
    decision.append_id ||
    decision.signed
  ) return nope('invalid_input', 400);
  const teacherId = row.submission.object_id.replace(/^teacher-homepage:/, '');
  const target = readDemoTeacherHomepageTarget(row.school_id, teacherId);
  if (
    row.state !== 'waiting' ||
    request.revision !== row.revision ||
    decision.revision !== (target?.revision ?? row.object_revision) ||
    decision.object_id !== row.submission.object_id
  ) return nope('conflict', 409);

  if (decision.action === 'hide') {
    const result = hideDemoTeacherHomepageTarget(row.school_id, teacherId, decision.revision);
    if (result !== 'ok') return nope(result, result === 'conflict' ? 409 : 404);
  }
  row.state = 'applied';
  row.revision++;
  row.decision = { ...decision, id: `demo-decision:${row.id}` };
  row.updated_at = d.ago(0);
  const result = structuredClone(row);
  complaintReplays.set(replayKey, { body: serialized, result });
  return json(result);
}

function reviewResource(p: string) {
  const raw = decodeURIComponent(p.split('/')[3] ?? '').replace(/^resource:/, '');
  const versionId = raw.includes(':') ? raw.split(':')[1]! : raw;
  const row = d.resources.find(
    (item) => item.proposal?.id === versionId || item.current?.id === versionId || item.id === versionId,
  );
  if (!row) return nope('not_found', 404);
  if (p.endsWith('/file')) {
    return new Response('%PDF-1.4\n%%EOF\n', {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    });
  }
  return json({
    id: row.id,
    revision: row.revision,
    state: row.state,
    ...(row.current ? { current: row.current } : {}),
    ...(row.proposal ? { proposal: { ...row.proposal, state: 'pending' } } : {}),
    download_allowed: false,
    access_reason: 'allowed',
    owned: Boolean(row.owned),
  });
}

export async function handleDemoRequest(
  u: URL,
  method: string,
  init?: RequestInit,
): Promise<Response> {
  const legal = await handleLegalRequest(u, method, init);
  if (legal) return legal;
  // The demo serves maintenance reads from the same objects as the public catalog.
  const p = u.pathname
    .replace('/api/v1', '')
    .replace(/^\/catalog\/admin\/objects/, '/catalog/objects');
  const teacherHomepage = await handleDemoTeacherHomepage(p, u.searchParams, method, init);
  if (teacherHomepage) return teacherHomepage;
  if (p === '/auth/session') {
    return json({
      authenticated: true,
      consent_required: false,
      content_school_id: d.SCHOOL,
      profile: {
        id: '00000000-0000-4000-8000-000000000001',
        nickname: '运营值班',
        nickname_required: false,
        bio: '',
        visibility: {
          school: true,
          badge: true,
          department: true,
          grade: false,
          reviews: true,
          resources: true,
        },
        group_card_consent: {
          school: false,
          grade: false,
          department: false,
          name: false,
          student_id: false,
          gender: false,
          nickname: false,
        },
        revision: 1,
      },
      csrf_token: DEMO_CSRF_TOKEN,
      phone_bound: true,
      administrator: true,
      expires_at: '2030-01-01T00:00:00Z',
    });
  }
  if (p === '/auth/logout' || p === '/auth/logout-all') {
    return new Response(null, { status: 204 });
  }
  if (p === '/profiles/me') {
    return json({
      id: '00000000-0000-4000-8000-000000000001',
      nickname: '运营值班',
      nickname_required: false,
      bio: '',
      visibility: {
        school: true,
        badge: true,
        department: true,
        grade: false,
        reviews: true,
        resources: true,
      },
      group_card_consent: {
        school: false,
        grade: false,
        department: false,
        name: false,
        student_id: false,
        gender: false,
        nickname: false,
      },
      revision: 1,
    });
  }
  if (p === '/system/capabilities') {
    return json({ api_version: 1, capabilities: demoCapabilities });
  }
  if (p === '/admin/modules') {
    return json(
      [
        ['session', 'ready', 'available'],
        ['catalog', 'ready', 'available'],
        ['reviews', 'ready', 'available'],
        ['moderation', 'ready', 'available'],
        ['resources', 'ready', 'available'],
        ['verification', 'ready', 'available'],
        ['billing', 'ready', 'available'],
        ['groups', 'ready', 'available'],
        ['qq-binding', 'ready', 'available'],
        ['open-platform', 'ready', 'available'],
        ['information-query', 'ready', 'available'],
        ['storage', 'ready', 'available'],
        ['legal', 'ready', 'available'],
      ].map(([id, state, health]) => ({ id, state, health })),
    );
  }

  if (p === '/catalog/objects') return catalog(u);
  if (p === '/catalog/objects/lookup') {
    const ids = (u.searchParams.get('ids') ?? '').split(',');
    const items = d.allObjects.filter((o) => ids.includes(o.id));
    return json({
      items,
      missing_ids: ids.filter((id) => !items.some((o) => o.id === id)),
    });
  }
  if (p.startsWith('/catalog/objects/')) {
    const o = d.allObjects.find(
      (x) => x.id === decodeURIComponent(p.split('/')[3]!),
    );
    return o ? json(o) : nope('not_found', 404);
  }

  if (p === '/moderation/feedback' && method === 'GET') {
    return json({ items: [], next_cursor: '' });
  }
  if (p === '/moderation/tasks/summary' && method === 'GET') {
    const school = u.searchParams.get('school_id');
    if (!school) return nope('invalid_input', 400);
    if (school !== d.SCHOOL) return nope('forbidden', 403);
    const includeTeacherHomepage = u.searchParams.get('include_teacher_homepage') ?? '';
    if (!['', 'false', 'true'].includes(includeTeacherHomepage)) return nope('invalid_input', 400);
    return json(moderationSummary(school, includeTeacherHomepage === 'true'));
  }
  if ((p === '/moderation/tasks' || p === '/moderation/tasks/page') && method === 'GET') {
    const q = u.searchParams;
    const category = q.get('category');
    if (category && !moderationSchemas.ViolationCategory.enum.includes(category)) {
      return nope('invalid_input', 400);
    }
    const include = q.get('include_teacher_homepage') ?? '';
    if (!['', 'false', 'true'].includes(include)) return nope('invalid_input', 400);
    const contentKind = q.get('content_kind');
    const includeTeacherHomepage = contentKind === 'teacher_homepage' || include === 'true';
    const after = q.get('after');
    const start = after ? tasks.findIndex((row) => row.id === after) + 1 : 0;
    const limit = Number(q.get('limit') ?? 20);
    if ((after && start === 0) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return nope('invalid_input', 400);
    }
    const list = tasks.slice(start).filter(
      (row) =>
        (includeTeacherHomepage || row.content_kind !== 'teacher_homepage') &&
        (!q.get('school_id') || row.school_id === q.get('school_id')) &&
        (!q.get('state') || row.state === q.get('state')) &&
        (!q.get('kind') || row.submission.kind === q.get('kind')) &&
        (!q.get('object_id') || row.submission.object_id === q.get('object_id')) &&
        (!category || taskCategory(row) === category) &&
        (!contentKind || row.content_kind === contentKind),
    );
    const items = list.slice(0, limit);
    if (p === '/moderation/tasks/page') {
      return json({ items, next_cursor: limit < list.length ? (items.at(-1)?.id ?? '') : '' });
    }
    return json(items);
  }
  const complaintTarget = /^\/moderation\/teacher-homepage-complaints\/([^/]+)\/target$/.exec(p);
  if (complaintTarget?.[1] && method === 'GET') {
    const teacherId = decodeURIComponent(complaintTarget[1]);
    const target = readDemoTeacherHomepageTarget(d.SCHOOL, teacherId);
    return target ? json({ object_id: `teacher-homepage:${teacherId}`, school_id: d.SCHOOL, ...target }) : nope('not_found', 404);
  }
  if (p === '/moderation/tasks/batch-preview') {
    return json({ preview_token: 'demo', items: [] });
  }
  if (p === '/moderation/tasks/batch') return json({ preview_token: 'demo', items: [] });
  if (p.startsWith('/moderation/tasks/')) {
    const row = tasks.find((x) => x.id === p.split('/')[3]);
    if (!row) return nope('not_found', 404);
    if (p.endsWith('/decisions') && method === 'POST') {
      let input: DemoTaskDecision;
      try {
        input = parseDecide(await body(init));
      } catch {
        return nope('invalid_input', 400);
      }
      if (!isValidModerationReason(input.decision.reason)) return nope('invalid_input', 400);
      if (row.content_kind === 'teacher_homepage') return decideDemoTeacherComplaint(row, input, init);
      if (input.revision !== row.revision) return nope('conflict', 409);
      if (input.decision.object_id !== row.submission.object_id) return nope('invalid_input', 400);
      if (input.decision.action === 'reassign') {
        const entry = entries.find((item) => item.id === row.submission.object_id);
        const teachers = input.decision.teacher_ids;
        if (!entry || input.decision.revision !== entry.revision ||
            input.decision.evidence_revision !== `demo-ev-${entry.revision}`) return nope('conflict', 409);
        const options = demoCourseTeacherIds(entry.input.target_id, entry.input.term_id);
        if (!teachers || teachers.some((id) => !options.includes(id))) return nope('invalid_input', 400);
        entry.input.teacher_ids = teachers;
        entry.revision++;
      }
      row.state = 'decided';
      row.revision++;
      row.decision = { ...input.decision, id: `demo-decision-${row.id}-${row.revision}` };
      row.updated_at = d.ago(0);
      return json(row);
    }
    return json(row);
  }
  if (p === '/moderation/policies' && method === 'GET') {
    const kind = u.searchParams.get('kind') ?? 'course';
    const effective = policies[kind] ?? {
      school_id: d.SCHOOL,
      kind,
      mode: kind === 'resource' ? 'pending' : 'published',
      blocked_terms: ['代写', '刷分'],
      revision: 1,
    };
    return json({
      configured: policies[kind] ?? null,
      effective,
      source: policies[kind] ? 'school' : 'default',
    });
  }
  if (p === '/moderation/policies') {
    const b = await body(init);
    policies[b.kind] = { ...b, revision: (b.revision ?? 0) + 1 };
    return json({ ok: true });
  }

  if (p === '/reviews/admin/entries') {
    return json({
      items: entries.filter(
        (row) =>
          !u.searchParams.get('state') ||
          row.state === u.searchParams.get('state'),
      ),
      next: '',
    });
  }
  if (p.startsWith('/reviews/admin/entries/')) {
    const row = entries.find((x) => x.id === p.split('/')[4]);
    if (!row) return nope('not_found', 404);
    if (p.endsWith('/history')) return json([row]);
    if (p.endsWith('/attribution')) {
      const selection = (await body(init)).teacher_ids;
      const options = demoCourseTeacherIds(row.input.target_id, row.input.term_id);
      if (!Array.isArray(selection) || new Set(selection).size !== selection.length ||
          selection.some((id) => typeof id !== 'string' || !options.includes(id))) return nope('invalid_input', 400);
      return json({
        revision: row.revision,
        evidence_revision: `demo-ev-${row.revision}`,
        teacher_ids: selection.length ? selection : options,
        previous_teacher_ids: row.input.teacher_ids?.length ? row.input.teacher_ids : options,
      });
    }
    return json(row);
  }
  if (p === '/reviews/admin/presentation' || p === '/reviews/presentation') {
    return json({
      effective: { school_id: d.SCHOOL, revision: 1, rating_texts: {} },
      configured: null,
      source: 'default',
    });
  }

  if (p === '/resources/capabilities') return json(d.capabilities);
  if (p === '/resources/categories') {
    return json({ items: d.resCategories, next_cursor: '' });
  }
  if (p.startsWith('/resources/categories/')) {
    return json(
      d.resCategories.find((c) => c.id === p.split('/')[3]) ?? d.resCategories[0],
    );
  }
  if (p === '/resources/directories') {
    return json({ items: d.directories, next_cursor: '' });
  }
  if (p.startsWith('/resources/directories/')) return json(d.directories[0]);
  if (p === '/resources/manage' || p === '/resources') {
    return json({ items: d.resources, next_cursor: '' });
  }
  if (p === '/resources/requests') {
    return json({ items: d.receipts, next_cursor: '' });
  }
  if (p.startsWith('/resources/review/')) return reviewResource(p);
  if (p.endsWith('/grants')) return json({ items: [], next_cursor: '' });
  if (p.startsWith('/resources/items/')) {
    const row = d.resources.find((r) => r.id === p.split('/')[3]);
    return row ? json(row) : nope('not_found', 404);
  }

  if (p === '/verification/schools') return json([d.verification.school]);
  if (p === '/admin/verification/access') return json({ allowed: true });
  // Teacher review in the demo starts with an empty queue; qualifications are looked up by ID.
  if (p.endsWith('/teacher-applications')) return json([]);
  if (p.startsWith('/admin/verification/teacher-credentials/')) {
    return nope('not_found', 404);
  }
  if (p.startsWith('/admin/verification/schools/') && p.endsWith('/applications')) {
    return json(applications);
  }
  if (p.startsWith('/admin/verification/schools/') && p.endsWith('/requests')) {
    return json([
      {
        id: 'rv1',
        credential_id: 'cred',
        school_id: d.SCHOOL,
        kind: 'revoke',
        state: 'pending',
        reason: '同学申请注销认证',
        note: '',
        revision: 1,
        created_at: d.ago(2),
      },
    ]);
  }
  if (p.startsWith('/admin/verification/schools/')) {
    return json(d.verification.school);
  }
  if (p.startsWith('/admin/verification/jobs')) {
    return json([
      {
        id: 'job1',
        school_id: d.SCHOOL,
        kind: 'mail',
        state: 'manual',
        attempts: 3,
        code: 'mail_rejected',
      },
    ]);
  }
  if (p === '/admin/verification/suggestions') return json([]);
  if (p.startsWith('/admin/verification/credentials/')) {
    return json(d.verification.credential('active'));
  }

  if (p === '/open-platform/admin/apps' && method === 'GET') {
    return json({ items: [] });
  }
  if (p === '/information-query/audit/query' && method === 'POST') {
    return json({ items: [], next_cursor: '' });
  }

  const billing = billingRoute(p, method, u);
  if (billing) return billing;
  const groups = groupsRoute(p, method);
  if (groups) return groups;

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

// QQ groups: two groups with a few members; commands report a pending bot action.
const zero = '0001-01-01T00:00:00Z';
const groupConfig = (id: string, name: string, number: string) => ({
  id,
  school: d.SCHOOL,
  name,
  number,
  bot_enabled: true,
  revision: 3,
  password_set: false,
  mode: 'before',
  require_student: true,
  accept_alumni: false,
  accept_temporary: true,
  discoverable: true, category: 'course', description: 'Algorithms', password_hint: '',
  grace_seconds: 72 * 3600,
  reminder_seconds: 24 * 3600,
  retention_seconds: 7 * 86_400,
  card_template: '{name}-{grade}',
  auto_card: false,
  dice_sides: 6,
  mute_probability: 10,
  mute_seconds: 60,
  cooldown_seconds: 300,
  pity: 10,
  keywords: ['代写'],
  repeat_threshold: 5,
  auto_actions: ['warn'],
  welcome: '欢迎加入，请先完成学生认证。',
  rules_template: '请文明交流。',
  check_card: true,
  remind_card: true,
  block_links: false,
  frequency_seconds: 10,
  frequency_limit: 8,
  warning_limit: 3,
});
const groupList = [
  groupConfig('g1', '2026 秋 数据结构答疑群', '****4821'),
  groupConfig('g2', 'StuHelper 反馈群', '****7109'),
];
const member = (owner: string, state: string, hours: number) => ({
  owner,
  state,
  deadline: hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : zero,
  reminder: zero,
  password: false,
  exempt: state === 'exempt',
  extended: false,
  failures: 0,
  last_play: zero,
  muted_until: zero,
  id: owner,
  joined: state !== 'removed',
});
function groupsRoute(p: string, method: string) {
  if (!p.startsWith('/groups')) return undefined;
  if (p === '/groups') {
    return json({
      items: groupList.map((g, i) => ({
        id: g.id,
        school: g.school,
        name: g.name,
        number: g.number,
        member_count: i ? 1280 : 412,
        bot_enabled: g.bot_enabled,
        require_student: g.require_student,
        pending_count: i ? 0 : 2,
        revision: g.revision,
      })),
      next_cursor: '',
    });
  }
  const parts = p.split('/');
  const id = parts[2];
  const collection = parts[3];
  const group = groupList.find((g) => g.id === id);
  if (!group) return nope('groups_not_found', 404);
  if (!collection) {
    return method === 'GET'
      ? json(group)
      : json({ ...group, revision: group.revision + 1 });
  }
  if (collection === 'commands') {
    return json({
      id: 'act-demo',
      state: 'pending',
      action: 'queued',
      value: 0,
      detail: '',
    });
  }
  if (collection === 'members') {
    return json({
      items: [
        member('user-1024', 'grace', 30),
        member('user-2048', 'joined', 0),
        member('user-4096', 'exempt', 0),
      ],
      next_cursor: '',
    });
  }
  if (collection === 'actions') {
    return json({
      items: [
        {
          id: 'a1',
          group: id,
          actor: billingTarget,
          capability: 'groups.manage',
          command: { kind: 'warn', target: 'user-2048' },
          state: 'unknown',
          result: '',
          created: d.ago(1),
        },
      ],
      next_cursor: '',
    });
  }
  if (collection === 'reports') {
    return json({
      items: [
        {
          id: 'r1',
          reporter: 'user-1024',
          message: 'm1',
          reason: '广告',
          state: 'suggested',
          analysis: '疑似广告链接',
          suggestions: ['recall', 'warn'],
        },
      ],
      next_cursor: '',
    });
  }
  if (collection === 'hits') {
    return json({
      items: [
        {
          id: 'h1',
          owner: 'user-2048',
          message: 'm2',
          rules: ['keyword'],
          state: 'noncompliant',
        },
      ],
      next_cursor: '',
    });
  }
  return json({ items: [], next_cursor: '' });
}

// Billing administration over a small fixed data set; writes echo a plausible result.
const billingTarget = {
  issuer: 'https://id.example.invalid',
  subject: 'demo-user',
};
const billingOrder = (
  id: string,
  kind: string,
  state: string,
  amount: number,
) => ({
  id,
  kind,
  state,
  amount_minor: amount,
  points: kind === 'purchase' ? 120 : 0,
  reference: 'demo',
  channel: 'demo-pay',
  reason: '',
  created_at: d.ago(1),
  allocations: [],
  original_points: 0,
  original_amount_minor: 0,
  receipt_reference: state === 'awaiting_manual' ? 'demo-receipt' : '',
  failure_code: '',
});
function billingRoute(p: string, method: string, u: URL) {
  if (!p.startsWith('/billing/admin/')) return undefined;
  const path = p.slice('/billing/admin'.length);
  if (method === 'GET') {
    if (path === '/refunds') {
      const state = u.searchParams.get('state') ?? 'submitted';
      return json({
        items: ['awaiting_manual', 'submitted'].includes(state)
          ? [
              {
                ...billingOrder(`refund-${state}`, 'refund', state, 3000),
                target: billingTarget,
              },
            ]
          : [],
        next: '',
      });
    }
    if (path === '/membership-plans') return json({ items: [], next: '' });
    if (path === '/channels') {
      return json({
        items: [
          {
            id: 'demo-pay',
            enabled: true,
            amounts_minor: [1000, 3000, 5000],
            original_refunds: true,
          },
        ],
        next: '',
      });
    }
    if (path === '/offers') {
      return json({
        items: [
          {
            id: 'points-120',
            enabled: true,
            amount_minor: 1000,
            points: 120,
            valid_seconds: 365 * 86_400,
            version: 1,
          },
        ],
        next: '',
      });
    }
    if (path === '/rules') {
      return json({
        items: [
          {
            id: 'review-published',
            version: 1,
            effective_at: d.ago(30),
            enabled: true,
            points: 5,
            valid_seconds: 0,
            period_seconds: 86_400,
            limit: 3,
            object_scoped: true,
          },
        ],
        next: '',
      });
    }
    if (path === '/accounts') {
      return json({
        target: billingTarget,
        rewards: { items: [], next: '' },
        wallet: {
          permanent_points: 133,
          expiring_points: 0,
          expiring_soon_points: 0,
          points: 133,
          ivory_minor: 2000,
          frozen_ivory_minor: 0,
          debt_points: 0,
          frozen: false,
        },
        orders: {
          items: [billingOrder('purchase-1', 'purchase', 'succeeded', 1000)],
          next: '',
        },
        ledger: {
          items: [
            {
              id: 'entry-1',
              asset: 'points',
              kind: 'reward',
              amount: 5,
              reference: 'review-published',
              created_at: d.ago(2),
            },
          ],
          next: '',
        },
      });
    }
    return nope('billing_not_found', 404);
  }
  if (path.endsWith('/review')) {
    return json(billingOrder(path.split('/')[2] ?? '', 'refund', 'processing', 3000));
  }
  if (path.endsWith('/manual-result')) {
    return json(billingOrder(path.split('/')[2] ?? '', 'refund', 'succeeded', 3000));
  }
  if (path === '/purchase-refunds') {
    return json(billingOrder('purchase-refund-1', 'purchase_refund', 'succeeded', 1000));
  }
  if (path === '/rewards' || path === '/revocations') {
    return json({
      event_id: 'demo-event',
      rule_id: 'review-published',
      version: 1,
      points: 5,
      state: 'granted',
      occurred_at: d.ago(0),
      lot_id: 'lot-1',
      revoked: path === '/revocations',
    });
  }
  return nope('billing_not_found', 404);
}

export function installDemoFetch() {
  // The real session transport reads this cookie. The demo has no HTTP login to set it.
  // eslint-disable-next-line unicorn/no-document-cookie
  document.cookie = `stuhelper_csrf=${DEMO_CSRF_TOKEN}; Path=/; SameSite=Strict`;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const u = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (u.origin !== window.location.origin || !u.pathname.startsWith('/api/')) {
      return realFetch(input, init);
    }
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 150));
    // Fetch supplies Origin at the network boundary. Mirror it for intercepted writes.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (method !== 'GET' && !headers.has('Origin')) headers.set('Origin', u.origin);
    const response = await handleDemoRequest(u, method, { ...init, headers });
    if (response.status >= 400) {
      console.warn('[demo]', method, u.pathname, response.status);
    }
    return response;
  };
}
