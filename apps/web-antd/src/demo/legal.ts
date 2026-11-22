import type { components } from '../api/legal.gen';

import { renderLegalDemo } from './legal-render';

type Document = components['schemas']['AdminDocument'];
type Draft = components['schemas']['DraftContent'];
type Variable = components['schemas']['Variable'];
type PublicDocument = components['schemas']['PublicDocument'];

type Publication = Pick<PublicDocument, 'digest' | 'effective_date' | 'html'> & {
  published_at: string;
  title: string;
  variables: ReadonlyMap<string, string>;
};
type StoredVersion = Omit<Document, 'changed_variables' | 'digest' | 'html' | 'published_at' | 'published_by'> & {
  publication?: Publication;
};
type Replayed = { input: string; response: Response };

const root = '/api/v1/admin/legal';
const publicRoot = '/api/v1/legal/documents';
const actor = { issuer: 'https://demo.invalid', subject: 'demo-admin' };
const initialDate = '2025-01-01';
const initialTime = '2025-01-01T00:00:00.000Z';
const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const variableKeyPattern = /^[a-z][a-z0-9_]{0,63}$/u;
const textEncoder = new TextEncoder();
const compare = (first: string, second: string) =>
  first < second ? -1 : (first > second ? 1 : 0);
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const problem = (code: string, status: number) => json({ code }, status);
const invalid = () => problem('invalid_input', 400);
const missing = () => problem('not_found', 404);
const noContent = () =>
  new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
const variableKey = (key: string) =>
  variableKeyPattern.test(key) && key !== 'document_version' && key !== 'effective_date';
const documentKey = (slug: string, version: string) => `${slug}/${version}`;

function byteLength(input: string) {
  return textEncoder.encode(input).byteLength;
}

function legalText(value: unknown, maxLength: number, required = true): value is string {
  return typeof value === 'string' && (!required || value.trim().length > 0) &&
    !value.includes('\0') && byteLength(value) <= maxLength;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000')) return false;
  const time = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(time.getTime()) && time.toISOString().startsWith(value);
}

function formObject(raw: string, headers: Headers): Record<string, unknown> | Response {
  if (byteLength(raw) > 1_048_576) return problem('payload_too_large', 413);
  if (raw === '') return invalid();
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?$/iu.test(headers.get('Content-Type') ?? '')) {
    return problem('unsupported_media_type', 415);
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return invalid();
  }
  return invalid();
}

function draftForm(form: Record<string, unknown>, creating = false): Draft | undefined {
  const { title, markdown, effective_date } = form;
  const fields = new Set(['effective_date', 'markdown', 'title']);
  if (creating) fields.add('version');
  if (Object.keys(form).some((key) => !fields.has(key))) return;
  if (!legalText(title, 256) || /[\r\n]/u.test(title) || !legalText(markdown, 131_072)) return;
  if (effective_date === null || effective_date === undefined || effective_date === '') {
    return { title, markdown };
  }
  if (typeof effective_date === 'string' && validDate(effective_date)) {
    return { title, markdown, effective_date };
  }
}

function variableForm(form: Record<string, unknown>, creating: boolean) {
  const { description, value } = form;
  const fields = creating ? ['key', 'description', 'value'] : ['description', 'value'];
  if (Object.keys(form).some((key) => !fields.includes(key))) return;
  if (legalText(description, 512) && legalText(value, 4096, false)) {
    return { description, value };
  }
}

function page<T>(items: T[], query: URLSearchParams) {
  const limits = query.getAll('limit');
  const offsets = query.getAll('offset');
  if (limits.length > 1 || offsets.length > 1) return invalid();
  const limitText = limits[0] ?? '20';
  const offsetText = offsets[0] ?? '0';
  if (!/^\d+$/u.test(limitText) || !/^\d+$/u.test(offsetText)) return invalid();
  const limit = Number(limitText);
  const offset = Number(offsetText);
  if (limit < 1 || limit > 100 || offset > 2_147_483_647) return invalid();
  const next = offset + limit;
  return json({
    items: items.slice(offset, next),
    ...(next < items.length && next <= 2_147_483_647 ? { next_offset: next } : {}),
  });
}

function publicDocument(record: StoredVersion, published: Publication): PublicDocument {
  return {
    slug: record.slug,
    version: record.version,
    title: published.title,
    html: published.html,
    digest: published.digest,
    effective_date: published.effective_date,
    published_at: published.published_at,
  };
}

async function seedVersions(variables: ReadonlyMap<string, Variable>) {
  const termsTitle = 'StuHelper 用户服务协议';
  const termsMarkdown = '## 服务范围\n\n本演示服务由 {{service_operator}} 提供。';
  const privacyTitle = 'StuHelper 隐私政策';
  const privacyMarkdown = '## 个人信息\n\n此处展示法律文件的发布与版本维护流程。';
  const drafts: StoredVersion[] = [
    {
      slug: 'terms',
      version: '3.1',
      title: termsTitle,
      markdown: termsMarkdown,
      effective_date: '2026-01-01',
      status: 'draft',
      revision: 1,
    },
    {
      slug: 'upload-license',
      version: '3.0',
      title: 'StuHelper 资料上传授权协议',
      markdown: '## 授权范围\n\n请在上传资料前阅读本协议。',
      status: 'draft',
      revision: 4,
    },
  ];
  const published: StoredVersion[] = await Promise.all([
    { slug: 'terms', revision: 2, title: termsTitle, markdown: termsMarkdown },
    { slug: 'privacy', revision: 3, title: privacyTitle, markdown: privacyMarkdown },
  ].map(async (source): Promise<StoredVersion> => {
    const version = '3.0';
    const rendered = await renderLegalDemo(source, version, initialDate, variables);
    if ('issues' in rendered) throw new Error('invalid_legal_demo_fixture');
    return {
      ...source,
      version,
      effective_date: initialDate,
      status: 'published',
      publication: { ...rendered, effective_date: initialDate, published_at: initialTime },
    };
  }));
  return new Map([...drafts, ...published].map((record) => [
    documentKey(record.slug, record.version),
    record,
  ]));
}

export function createDemoLegalHandler({
  administrator = true,
  csrfToken,
  clock = () => new Date(),
}: {
  administrator?: boolean;
  clock?: () => Date;
  csrfToken: string;
}) {
  const variables = new Map<string, Variable>([['service_operator', {
    key: 'service_operator',
    description: 'StuHelper 服务运营方',
    value: 'StuHelper 演示运营团队',
    revision: 1,
    updated_at: initialTime,
    updated_by: actor,
  }]]);
  // Seed lazily so the demo's unrelated endpoints do not wait for rendering.
  let versions: Promise<Map<string, StoredVersion>> | undefined;
  let documentRevision = 4;
  let variableRevision = 1;
  let lastWrite = Promise.resolve();
  const operations = new Map<string, Replayed>();

  function visibleVersion(record: StoredVersion): Document {
    const { publication, ...version } = record;
    const changed = record.status === 'published' && publication
      ? [...publication.variables].filter(([key, value]) => variables.get(key)?.value !== value)
        .map(([key]) => key).toSorted(compare)
      : [];
    return {
      ...version,
      changed_variables: changed,
      ...(publication ? {
        digest: publication.digest,
        html: publication.html,
        published_at: publication.published_at,
        published_by: actor,
      } : {}),
    };
  }

  function listVersions(records: Map<string, StoredVersion>, query: URLSearchParams, slug?: string) {
    const rows = [...records.values()].filter((record) => !slug || record.slug === slug);
    rows.sort((a, b) => compare(a.slug, b.slug) || b.revision - a.revision);
    return page(rows.map((record) => {
      const { html: _html, markdown: _markdown, ...metadata } = visibleVersion(record);
      return metadata;
    }), query);
  }

  function publicRoute(u: URL, records: Map<string, StoredVersion>, path: string[]) {
    const [slug, collection, version, resource] = path;
    if (!slug || !slugPattern.test(slug) || slug.length > 64 ||
      (version && !versionPattern.test(version)) || path.length > 4) return invalid();
    if (collection && collection !== 'html' && collection !== 'versions') return missing();

    const now = clock();
    const effectiveDay = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const byVersion = collection === 'versions' && Boolean(version);
    const publicRows = [...records.values()].flatMap((record) => {
      const publication = record.publication;
      if (record.slug !== slug || !publication || new Date(publication.published_at) > now) return [];
      if (!byVersion && collection !== 'versions' &&
        (record.status !== 'published' || publication.effective_date > effectiveDay)) return [];
      return [publicDocument(record, publication)];
    });
    publicRows.sort((a, b) =>
      compare(b.effective_date, a.effective_date) ||
      compare(b.published_at, a.published_at) ||
      compare(b.version, a.version),
    );
    if (collection === 'versions' && !version) {
      return page(publicRows.map(({ html: _html, ...metadata }) => metadata), u.searchParams);
    }
    const chosen = byVersion ? publicRows.find((record) => record.version === version) : publicRows[0];
    if (!chosen) return missing();
    if (collection === 'html' || resource === 'html') {
      return new Response(chosen.html, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }
    return json(chosen);
  }

  function mutate(
    path: string,
    method: string,
    headers: Headers,
    raw: string,
    revisionRequired: boolean,
    apply: (revision?: bigint) => Promise<Response> | Response,
  ) {
    const key = headers.get('Idempotency-Key') ?? '';
    const revisionText = headers.get('If-Match') ?? '';
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(key)) return invalid();
    if (revisionRequired && !/^"[1-9]\d{0,18}"$/u.test(revisionText)) return invalid();
    const revision = revisionRequired ? BigInt(revisionText.slice(1, -1)) : undefined;
    if (revision !== undefined && revision > 9_223_372_036_854_775_807n) return invalid();
    const input = JSON.stringify([path, method, raw, revisionText]);
    const result = lastWrite.then(async () => {
      const previous = operations.get(key);
      if (previous) {
        return previous.input === input
          ? previous.response.clone()
          : problem('idempotency_conflict', 409);
      }
      const response = await apply(revision);
      if (response.ok) operations.set(key, { input, response: response.clone() });
      return response;
    });
    lastWrite = result.then(() => {}, () => {});
    return result;
  }

  function variablesRoute(u: URL, key: string | undefined, method: string, headers: Headers, raw: string) {
    if (key !== undefined && !variableKey(key)) return invalid();
    if (method === 'GET') {
      if (!key) {
        const sorted = [...variables.values()].toSorted((a, b) => compare(a.key, b.key));
        return page(sorted, u.searchParams);
      }
      const variable = variables.get(key);
      return variable ? json(variable) : missing();
    }

    const creating = !key && method === 'POST';
    const editing = key !== undefined && method === 'PUT';
    const deleting = key !== undefined && method === 'DELETE';
    if (!creating && !editing && !deleting) return missing();
    return mutate(u.pathname, method, headers, raw, !creating, (revision) => {
      if (deleting) {
        if (raw !== '') return invalid();
        const current = variables.get(key);
        if (!current) return missing();
        if (revision !== BigInt(current.revision)) return problem('revision_conflict', 409);
        variables.delete(key);
        return noContent();
      }

      const form = formObject(raw, headers);
      if (form instanceof Response) return form;
      const content = variableForm(form, creating);
      const name = creating ? form.key : key;
      if (!content || typeof name !== 'string' || !variableKey(name)) return invalid();
      const current = variables.get(name);
      if (creating && current) return problem('already_exists', 409);
      if (creating && variables.size >= 1024) return problem('capacity_exceeded', 409);
      if (!creating) {
        if (!current) return missing();
        if (revision !== BigInt(current.revision)) return problem('revision_conflict', 409);
      }
      const saved = {
        ...content,
        key: name,
        revision: ++variableRevision,
        updated_at: clock().toISOString(),
        updated_by: actor,
      };
      variables.set(name, saved);
      return json(saved, creating ? 201 : 200);
    });
  }

  async function preview(record: StoredVersion, headers: Headers, raw: string) {
    if (record.publication) {
      if (raw !== '') return problem('invalid_status', 409);
      const { title, digest, html } = record.publication;
      return json({ title, digest, html });
    }
    let draft: Draft = record;
    if (raw !== '') {
      const form = formObject(raw, headers);
      if (form instanceof Response) return form;
      const content = draftForm(form);
      if (!content) return invalid();
      draft = content;
    }
    const rendered = await renderLegalDemo(draft, record.version, draft.effective_date ?? '', variables);
    if ('issues' in rendered) return json({ code: 'validation_failed', issues: rendered.issues }, 422);
    const { title, digest, html } = rendered;
    return json({ title, digest, html });
  }

  function documentsRoute(
    u: URL,
    records: Map<string, StoredVersion>,
    slug: string | undefined,
    version: string | undefined,
    command: string | undefined,
    method: string,
    headers: Headers,
    raw: string,
  ) {
    if (slug !== undefined && (!slugPattern.test(slug) || slug.length > 64)) return invalid();
    if (version !== undefined && !versionPattern.test(version)) return invalid();
    if (method === 'GET' && !command) {
      if (!slug || !version) return listVersions(records, u.searchParams, slug);
      const record = records.get(documentKey(slug, version));
      return record ? json(visibleVersion(record)) : missing();
    }
    if (!slug) return missing();
    if (method === 'POST' && !version && !command) {
      return mutate(u.pathname, method, headers, raw, false, () => {
        const form = formObject(raw, headers);
        if (form instanceof Response) return form;
        const content = draftForm(form, true);
        if (!content || typeof form.version !== 'string' || !versionPattern.test(form.version)) return invalid();
        const key = documentKey(slug, form.version);
        if (records.has(key)) return problem('already_exists', 409);
        const saved: StoredVersion = {
          ...content,
          slug,
          version: form.version,
          status: 'draft',
          revision: ++documentRevision,
          effective_date: content.effective_date ?? undefined,
        };
        records.set(key, saved);
        return json(visibleVersion(saved), 201);
      });
    }
    if (!version) return missing();
    const key = documentKey(slug, version);
    if (method === 'POST' && command === 'preview') {
      const record = records.get(key);
      return record ? preview(record, headers, raw) : missing();
    }
    const editing = method === 'PUT' && !command;
    const deleting = method === 'DELETE' && !command;
    const publishing = method === 'POST' && command === 'publish';
    const archiving = method === 'POST' && command === 'archive';
    if (!editing && !deleting && !publishing && !archiving) return missing();

    return mutate(u.pathname, method, headers, raw, true, async (revision) => {
      if (!editing && raw !== '') return invalid();
      const current = records.get(key);
      if (!current) return missing();
      if (revision !== BigInt(current.revision)) return problem('revision_conflict', 409);
      if (current.status !== (archiving ? 'published' : 'draft')) return problem('invalid_status', 409);
      const next = { ...current };
      if (editing) {
        const form = formObject(raw, headers);
        if (form instanceof Response) return form;
        const content = draftForm(form);
        if (!content) return invalid();
        next.title = content.title;
        next.markdown = content.markdown;
        next.effective_date = content.effective_date ?? undefined;
      } else if (deleting) {
        records.delete(key);
        return noContent();
      } else if (publishing) {
        if (!next.effective_date) {
          return json({ code: 'validation_failed', issues: [{ code: 'required', key: 'effective_date' }] }, 422);
        }
        const rendered = await renderLegalDemo(next, version, next.effective_date, variables);
        if ('issues' in rendered) return json({ code: 'validation_failed', issues: rendered.issues }, 422);
        next.status = 'published';
        next.publication = { ...rendered, effective_date: next.effective_date, published_at: clock().toISOString() };
      } else {
        next.status = 'archived';
      }
      next.revision = ++documentRevision;
      records.set(key, next);
      return json(visibleVersion(next));
    });
  }

  return async (u: URL, method: string, init?: RequestInit): Promise<Response | undefined> => {
    if (u.pathname.startsWith(`${publicRoot}/`)) {
      if (method !== 'GET') return missing();
      versions ??= seedVersions(variables);
      const parts = u.pathname.slice(publicRoot.length + 1).split('/');
      return publicRoute(u, await versions, parts);
    }
    if (!u.pathname.startsWith(`${root}/`)) return undefined;
    if (!administrator) return problem('forbidden', 403);
    const headers = new Headers(init?.headers);
    if (method !== 'GET' && (headers.get('X-CSRF-Token') !== csrfToken || headers.get('Origin') !== u.origin)) {
      return problem('forbidden', 403);
    }
    versions ??= seedVersions(variables);
    const records = await versions;
    const raw = init?.body == null ? '' : String(init.body);
    const parts = u.pathname.slice(root.length + 1).split('/');
    if (parts[0] === 'variables' && parts.length <= 2) {
      return variablesRoute(u, parts[1], method, headers, raw);
    }
    if (parts[0] === 'documents' && (parts.length === 1 || (parts[2] === 'versions' && parts.length <= 5))) {
      return documentsRoute(u, records, parts[1], parts[3], parts[4], method, headers, raw);
    }
    return missing();
  };
}
