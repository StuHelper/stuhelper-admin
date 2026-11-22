import type { AdminDocument, DraftContent, Variable } from './api';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Http } from '#/shared/api/http';
import { Mutation } from '#/shared/api/mutation';
import { sessionFetch } from '#/shared/api/transport';

import { LegalApi, validationIssues } from './api';

const documentDraft: AdminDocument = {
  slug: 'terms',
  title: 'Terms',
  version: '2.0',
  status: 'draft',
  revision: 7,
  changed_variables: [],
  markdown: 'Original text.',
};
const draftContent: DraftContent = {
  title: 'Terms',
  markdown: 'Updated text.',
  effective_date: null,
};
const variable: Variable = {
  key: 'contact',
  description: 'Contact address',
  value: 'support@example.test',
  revision: 2,
  updated_at: '2026-11-22T00:00:00Z',
  updated_by: { issuer: 'https://sso.example.test', subject: 'demo-admin' },
};
const versionPath = '/api/v1/admin/legal/documents/terms/versions/2.0';
const variablesPath = '/api/v1/admin/legal/variables';

function lastRequest(fetcher: ReturnType<typeof vi.fn<typeof fetch>>) {
  const [url, init] = fetcher.mock.lastCall ?? [];
  const headers = new Headers(init?.headers);
  return {
    url,
    method: init?.method,
    body: init?.body,
    key: headers.get('Idempotency-Key'),
    revision: headers.get('If-Match'),
    csrf: headers.get('X-CSRF-Token'),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('legal administration API', () => {
  it('reads document and variable pages with the provider offset', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ items: [documentDraft], next_offset: 3 }),
      )
      .mockResolvedValueOnce(Response.json({ items: [variable] }));
    const api = new LegalApi(new Http(fetcher));

    await expect(api.listDocuments(2, undefined, 1)).resolves.toEqual({
      items: [documentDraft],
      next_offset: 3,
    });
    expect(lastRequest(fetcher).url).toBe(
      '/api/v1/admin/legal/documents?limit=1&offset=2',
    );
    await expect(api.listVariables()).resolves.toEqual({ items: [variable] });
    expect(lastRequest(fetcher).url).toBe(`${variablesPath}?limit=20&offset=0`);
  });

  it('sends the session CSRF token and the correct write preconditions', async () => {
    vi.stubGlobal('document', { cookie: 'stuhelper_csrf=fixture-csrf' });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, init) => {
        const route = String(url);
        if (init?.method === 'DELETE')
          return new Response(null, { status: 204 });
        return Response.json(
          route.startsWith(variablesPath) ? variable : documentDraft,
          {
            status:
              route.endsWith('/versions') || route === variablesPath
                ? 201
                : 200,
          },
        );
      });
    vi.stubGlobal('fetch', fetcher);
    const api = new LegalApi(new Http(sessionFetch));

    const { key: variableKey, description, value } = variable;
    const variableContent = { description, value };
    const cases = [
      {
        url: versionPath.replace('/2.0', ''),
        method: 'POST',
        revision: null,
        run: () =>
          api.createDraft(
            'terms',
            { ...draftContent, version: '2.0' },
            'create-draft',
          ),
      },
      {
        url: versionPath,
        method: 'PUT',
        revision: '"7"',
        run: () =>
          api.updateDraft('terms', '2.0', 7, draftContent, 'update-draft'),
      },
      {
        url: `${versionPath}/publish`,
        method: 'POST',
        revision: '"7"',
        run: () => api.publishVersion('terms', '2.0', 7, 'publish-document'),
      },
      {
        url: `${versionPath}/archive`,
        method: 'POST',
        revision: '"8"',
        run: () => api.archiveVersion('terms', '2.0', 8, 'archive-document'),
      },
      {
        url: versionPath,
        method: 'DELETE',
        revision: '"7"',
        run: () => api.deleteDraft('terms', '2.0', 7, 'delete-draft'),
      },
      {
        url: variablesPath,
        method: 'POST',
        revision: null,
        run: () =>
          api.createVariable(
            { key: variableKey, ...variableContent },
            'create-variable',
          ),
      },
      {
        url: `${variablesPath}/contact`,
        method: 'PUT',
        revision: '"2"',
        run: () =>
          api.updateVariable(
            variableKey,
            2,
            variableContent,
            'update-variable',
          ),
      },
      {
        url: `${variablesPath}/contact`,
        method: 'DELETE',
        revision: '"2"',
        run: () => api.deleteVariable(variableKey, 2, 'delete-variable'),
      },
    ];
    for (const { method, revision, run, url } of cases) {
      const result = await run();
      if (method === 'DELETE') expect(result).toBe(true);
      expect(lastRequest(fetcher)).toMatchObject({
        url,
        method,
        revision,
        key: expect.stringMatching(
          /^(?:create|update|publish|archive|delete)-/,
        ),
        csrf: 'fixture-csrf',
      });
    }
  });

  it('previews unsaved content and returns typed validation issues', async () => {
    const preview = {
      title: 'Terms',
      html: '<h1>Terms</h1><p>Updated text.</p>',
      digest: 'a'.repeat(64),
    };
    const issues = [{ code: 'undefined_variable', key: 'contact' }];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(
        Response.json({ code: 'validation_failed', issues }, { status: 422 }),
      )
      .mockRejectedValueOnce(new TypeError('Connection lost'));
    const api = new LegalApi(new Http(fetcher));

    await expect(
      api.previewVersion('terms', '2.0', draftContent),
    ).resolves.toEqual(preview);
    expect(lastRequest(fetcher)).toMatchObject({
      url: `${versionPath}/preview`,
      method: 'POST',
      body: JSON.stringify(draftContent),
      key: null,
      revision: null,
    });
    const rejected = api
      .previewVersion('terms', '2.0')
      .catch((error: unknown) => {
        expect(error).toMatchObject({
          code: 'validation_failed',
          status: 422,
          uncertain: false,
        });
        expect(validationIssues(error)).toEqual(issues);
        throw error;
      });
    await expect(rejected).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(api.previewVersion('terms', '2.0')).rejects.toMatchObject({
      code: 'network',
      uncertain: false,
    });
  });

  it('rereads a stale draft and uses a new key with the latest revision', async () => {
    const latest = {
      ...documentDraft,
      revision: 8,
      markdown: 'Edited remotely.',
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ code: 'revision_conflict' }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json(latest))
      .mockResolvedValueOnce(
        Response.json({
          ...latest,
          markdown: draftContent.markdown,
          revision: 9,
        }),
      );
    const api = new LegalApi(new Http(fetcher));
    const mutation = new Mutation();
    const save = (revision: number) =>
      mutation.run(
        'update',
        { revision, content: draftContent },
        (input, key) =>
          api.updateDraft('terms', '2.0', input.revision, input.content, key),
      );

    await expect(save(7)).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
      uncertain: false,
    });
    const first = lastRequest(fetcher);
    expect(mutation.uncertain).toBe(false);
    const reloaded = await api.getVersion('terms', '2.0');
    expect(reloaded).toEqual(latest);
    await expect(save(reloaded.revision)).resolves.toMatchObject({
      markdown: draftContent.markdown,
      revision: 9,
    });
    const second = lastRequest(fetcher);
    expect(second.body).toBe(first.body);
    expect(second.revision).toBe('"8"');
    expect(second.key).not.toBe(first.key);
  });

  it('resends only the original request body, key and revision after an uncertain save', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Connection lost'))
      .mockResolvedValueOnce(Response.json({ ...documentDraft, revision: 8 }));
    const api = new LegalApi(new Http(fetcher));
    const mutation = new Mutation();
    const input = { revision: 7, body: { ...draftContent } };

    await expect(
      mutation.run('update', input, (snapshot, key) =>
        api.updateDraft('terms', '2.0', snapshot.revision, snapshot.body, key),
      ),
    ).rejects.toMatchObject({ code: 'network', uncertain: true });
    const original = lastRequest(fetcher);
    input.body.markdown = 'Unrelated input.';
    input.revision = 9;
    await expect(
      mutation.run('publish', {}, () =>
        api.publishVersion('terms', '2.0', 9, 'publish'),
      ),
    ).rejects.toMatchObject({ code: 'retry_required' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(mutation.retry()).resolves.toMatchObject({ revision: 8 });
    expect(lastRequest(fetcher)).toEqual(original);
    expect(mutation.uncertain).toBe(false);
  });

  it('reports 403 through the shared denied callback without returning data', async () => {
    const onDenied = vi.fn();
    const api = new LegalApi(
      new Http(
        async () => Response.json({ code: 'forbidden' }, { status: 403 }),
        { onDenied },
      ),
    );
    await expect(api.listDocuments()).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
      denied: true,
    });
    expect(onDenied).toHaveBeenCalledExactlyOnceWith(403);
  });

  it('rejects unexpected results, invalid selectors and unsafe revisions', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [{ slug: 'terms' }] }));
    const api = new LegalApi(new Http(fetcher));

    await expect(api.listDocuments()).rejects.toMatchObject({
      code: 'incompatible',
    });
    expect(() => api.getVersion('terms', '..')).toThrow('invalid_input');
    expect(() =>
      api.updateDraft(
        'terms',
        '2.0',
        Number.MAX_SAFE_INTEGER + 1,
        draftContent,
        'update',
      ),
    ).toThrow('invalid_input');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
