import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import contract from '../../../../contracts/legal.openapi.json';
import { schemaOf } from '../shared/api/schema';
import { createDemoLegalHandler } from './legal';

const origin = 'http://127.0.0.1:5174';
const csrfToken = 'demo-csrf-fixture';
const root = '/api/v1/admin/legal';
const publicTerms = '/api/v1/legal/documents/terms';
const termsVersions = `${root}/documents/terms/versions`;
const termsDraft = `${termsVersions}/3.1`;
const variablePath = `${root}/variables/service_operator`;

const parseDocument = schemaOf(contract.components.schemas, 'AdminDocument');
const parseDocumentPage = schemaOf(contract.components.schemas, 'AdminDocumentPage');
const parsePreview = schemaOf(contract.components.schemas, 'Preview');
const parsePublished = schemaOf(contract.components.schemas, 'PublicDocument');
const parseVariable = schemaOf(contract.components.schemas, 'Variable');
const content = {
  title: 'Demo terms {{document_version}}',
  markdown: '## Test\n\nThese terms are from {{service_operator}}.',
  effective_date: '2026-01-01',
};

function fixture(administrator = true) {
  const serve = createDemoLegalHandler({
    csrfToken,
    administrator,
    clock: () => new Date('2026-01-01T00:00:01Z'),
  });
  return async (
    path: string,
    { method = 'GET', key, revision, body, csrf = csrfToken }: {
      body?: unknown;
      csrf?: string;
      key?: string;
      method?: string;
      revision?: number;
    } = {},
  ) => {
    const headers = new Headers({ Origin: origin, 'X-CSRF-Token': csrf });
    if (key) headers.set('Idempotency-Key', key);
    if (revision !== undefined) headers.set('If-Match', `"${revision}"`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await serve(new URL(path, origin), method, {
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response) throw new Error('missing_fixture_route');
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
    };
  };
}

describe('legal demo server', () => {
  it('paginates version metadata and exposes current publication separately', async () => {
    const call = fixture();
    const first = await call(`${root}/documents?limit=1`);
    expect(parseDocumentPage(first.body)).toMatchObject({
      items: [{ slug: 'privacy', status: 'published' }],
      next_offset: 1,
    });
    expect(first.body.items[0]).not.toHaveProperty('markdown');
    const second = await call(`${root}/documents?limit=1&offset=1`);
    expect(parseDocumentPage(second.body)).toMatchObject({
      items: [{ slug: 'terms', version: '3.0' }],
      next_offset: 2,
    });
    const current = await call(publicTerms);
    expect(parsePublished(current.body)).toMatchObject({
      version: '3.0',
    });
    await expect(call(`${publicTerms}/versions/3.1`)).resolves.toMatchObject({ status: 404 });
    await expect(call(`${root}/documents?limit=0`)).resolves.toMatchObject({ status: 400 });
  });

  it('updates with a revision, previews without saving and replays the original write', async () => {
    const call = fixture();
    const save = { method: 'PUT', key: 'update', revision: 1, body: content };
    const saved = await call(termsDraft, save);
    expect(saved.status).toBe(200);
    expect(parseDocument(saved.body)).toMatchObject({ ...content, status: 'draft' });
    expect(saved.body.revision).toBeGreaterThan(1);
    expect(await call(termsDraft, save)).toEqual(saved);
    expect(await call(termsDraft, { ...save, body: { ...content, title: 'Another title' } })).toMatchObject({
      status: 409,
      body: { code: 'idempotency_conflict' },
    });
    expect(await call(termsDraft, { ...save, key: 'stale' })).toMatchObject({
      status: 409,
      body: { code: 'revision_conflict' },
    });

    const rendered = await call(`${termsDraft}/preview`, {
      method: 'POST',
      body: { ...content, markdown: '**Unsaved** {{document_version}}' },
    });
    expect(rendered.status).toBe(200);
    expect(parsePreview(rendered.body)).toMatchObject({ title: 'Demo terms 3.1' });
    expect(rendered.body.html).toContain('<strong>Unsaved</strong> 3.1');
    expect(rendered.body.digest).toBe(createHash('sha256').update(rendered.body.html).digest('hex'));
    await expect(call(termsDraft)).resolves.toEqual(saved);
    expect(await call(`${termsDraft}/preview`, {
      method: 'POST',
      body: { ...content, markdown: 'Missing {{unknown_value}}' },
    })).toMatchObject({
      status: 422,
      body: { code: 'validation_failed', issues: [{ code: 'undefined_variable', key: 'unknown_value' }] },
    });
  });

  it('copies a version, keeps published snapshots when variables change, and exposes archived history', async () => {
    const call = fixture();
    const original = await call(`${termsVersions}/3.0`);
    const copied = await call(termsVersions, {
      method: 'POST',
      key: 'copy',
      body: { version: '4.0', title: original.body.title, markdown: original.body.markdown, effective_date: null },
    });
    expect(copied.status).toBe(201);
    expect(parseDocument(copied.body)).toMatchObject({ version: '4.0', status: 'draft' });

    const updated = await call(variablePath, {
      method: 'PUT',
      key: 'change-operator',
      revision: 1,
      body: { description: 'Updated operator', value: '<New provider>' },
    });
    expect(parseVariable(updated.body)).toMatchObject({ value: '<New provider>' });
    const affected = await call(`${termsVersions}/3.0`);
    expect(affected.body.changed_variables).toEqual(['service_operator']);
    expect(affected.body.html).toBe(original.body.html);

    const publish = { method: 'POST', key: 'publish', revision: 1 };
    const [published, replay] = await Promise.all([
      call(`${termsDraft}/publish`, publish),
      call(`${termsDraft}/publish`, publish),
    ]);
    expect(published.status).toBe(200);
    expect(replay).toEqual(published);
    await expect(call(publicTerms)).resolves.toMatchObject({
      body: { version: '3.1', digest: published.body.digest },
    });
    expect(published.body.html).toContain('&lt;New provider&gt;');

    const archived = await call(`${termsDraft}/archive`, {
      method: 'POST',
      key: 'archive',
      revision: published.body.revision,
    });
    expect(archived.body).toMatchObject({ status: 'archived', changed_variables: [] });
    await expect(call(publicTerms)).resolves.toMatchObject({ body: { version: '3.0' } });
    await expect(call(`${publicTerms}/versions/3.1`)).resolves.toMatchObject({
      body: { digest: published.body.digest },
    });

    const removed = await call(variablePath, {
      method: 'DELETE',
      key: 'delete-operator',
      revision: updated.body.revision,
    });
    expect(removed.status).toBe(204);
    await expect(call(variablePath)).resolves.toMatchObject({ status: 404 });
    await expect(call(`${termsVersions}/3.0`)).resolves.toMatchObject({
      body: { changed_variables: ['service_operator'] },
    });
  });

  it('rejects nonadministrators and missing write guards without changing state', async () => {
    const denied = fixture(false);
    expect(await denied(`${root}/documents`)).toMatchObject({ status: 403, body: { code: 'forbidden' } });
    await expect(denied(publicTerms)).resolves.toMatchObject({ status: 200 });
    const admin = fixture();
    const input = { method: 'PUT', key: 'save', revision: 1, body: content };
    await expect(admin(termsDraft, { ...input, csrf: '' })).resolves.toMatchObject({ status: 403 });
    await expect(admin(termsDraft, { ...input, key: undefined })).resolves.toMatchObject({ status: 400 });
    await expect(admin(termsDraft, { ...input, revision: undefined })).resolves.toMatchObject({ status: 400 });
    await expect(admin(termsDraft)).resolves.toMatchObject({ body: { revision: 1 } });
  });
});
