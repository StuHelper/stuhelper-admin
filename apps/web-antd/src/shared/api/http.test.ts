import { describe, expect, it, vi } from 'vitest';

import { Http, queryString } from './http';
import { schemaOf } from './schema';

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const anything = (value: unknown) => value;

describe('HTTP boundary', () => {
  it('allows an explicitly bounded large detail while preserving the default JSON limit', async () => {
    const body = JSON.stringify({ replies: Array.from({ length: 40 }, () => '<'.repeat(20_000)) }).replaceAll('<', String.raw`\u003c`);
    const client = new Http(async () => new Response(body));
    await expect(client.json('/api/v1/test', anything)).rejects.toMatchObject({ code: 'capacity_exceeded', uncertain: false });
    await expect(client.json('/api/v1/test', anything, { maxJsonBytes: 16 * 1024 * 1024 })).resolves.toHaveProperty('replies.length', 40);
    await expect(client.json('/api/v1/test', anything, { maxJsonBytes: 4 * 1024 * 1024 })).rejects.toMatchObject({ code: 'capacity_exceeded', uncertain: false });
  });

  it('rejects invalid JSON budgets before sending a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new Http(fetcher);
    for (const maxJsonBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 16 * 1024 * 1024 + 1]) {
      await expect(client.json('/api/v1/test', anything, { maxJsonBytes })).rejects.toMatchObject({ code: 'invalid_input', uncertain: false });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('calls the transport as a plain function with same-origin credentials and no redirects', async () => {
    const fetcher: typeof fetch = function (this: unknown, _input, init) {
      expect(this).toBeUndefined();
      expect(init?.credentials).toBe('same-origin');
      expect(init?.redirect).toBe('error');
      return Promise.resolve(json({ ok: true }));
    };
    await expect(
      new Http(fetcher).json('/api/v1/test', anything),
    ).resolves.toEqual({ ok: true });
  });

  it('rejects paths outside the API before sending anything', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new Http(fetcher).json('https://example.invalid/api', anything),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the server code, normalises module aliases and hides non-JSON error pages', async () => {
    const respond = (body: BodyInit, status: number) =>
      new Http(async () => new Response(body, { status }));
    await expect(
      respond(JSON.stringify({ code: 'school_credentials_rejected' }), 403).json(
        '/api/v1/x',
        anything,
      ),
    ).rejects.toMatchObject({ code: 'school_credentials_rejected', uncertain: false });
    await expect(
      respond(JSON.stringify({ code: 'permission_denied' }), 403).json(
        '/api/v1/x',
        anything,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      respond(
        JSON.stringify({ code: 'resources_permission_denied' }),
        403,
      ).json('/api/v1/x', anything),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      respond('<html>proxy error</html>', 404).json('/api/v1/x', anything),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      respond(JSON.stringify({ code: 'Not A Code!' }), 409).json(
        '/api/v1/x',
        anything,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('marks a write as uncertain after a lost response or a gateway failure, but not a read', async () => {
    const lost = new Http(async () => {
      throw new TypeError('connection reset');
    });
    await expect(
      lost.json('/api/v1/x', anything, { method: 'POST', body: {} }),
    ).rejects.toMatchObject({ code: 'network', uncertain: true });
    await expect(lost.json('/api/v1/x', anything)).rejects.toMatchObject({
      code: 'network',
      uncertain: false,
    });
    const gateway = new Http(
      async () => new Response('bad gateway', { status: 502 }),
    );
    await expect(
      gateway.json('/api/v1/x', anything, { method: 'PUT', body: {} }),
    ).rejects.toMatchObject({ code: 'unavailable', uncertain: true });
  });

  it('treats a failure with a recorded operation as a known outcome', async () => {
    const http = new Http(async () =>
      json(
        { code: 'dependency_unavailable', operation_id: 'a'.repeat(64) },
        503,
      ),
    );
    await expect(
      http.json('/api/v1/x', anything, { method: 'POST', body: {} }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      uncertain: false,
      operationId: 'a'.repeat(64),
    });
  });

  it('reports account denial so private data can be cleared', async () => {
    const onDenied = vi.fn();
    const http = new Http(
      async () => new Response('expired', { status: 401 }),
      { onDenied },
    );
    await expect(http.json('/api/v1/x', anything)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(onDenied).toHaveBeenCalledOnce();
  });

  it('rejects responses that do not match the contract schema', async () => {
    const parse = schemaOf<{ id: string }>(
      {
        Item: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
          additionalProperties: false,
        },
      },
      'Item',
    );
    const http = new Http(async () => json({ id: 'x', secret: 'leak' }));
    await expect(http.json('/api/v1/x', parse)).rejects.toMatchObject({
      code: 'incompatible',
    });
  });

  it('distinguishes cancellation by the caller from a timeout', async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
    const controller = new AbortController();
    const cancelled = new Http(hang).json('/api/v1/x', anything, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    await expect(
      new Http(hang).json('/api/v1/x', anything, { timeout: 5 }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('enforces timeouts, cancellation and stream error classification while reading response bodies', async () => {
    const stalledBody = () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        headers: { 'Content-Type': 'application/json' },
      });
    await expect(
      new Http(async () => stalledBody()).json('/api/v1/x', anything, {
        timeout: 10,
      }),
    ).rejects.toMatchObject({ code: 'timeout', uncertain: false, status: 200 });

    await expect(
      new Http(async () => stalledBody()).blob('/api/v1/x', 1024, {
        timeout: 10,
      }),
    ).rejects.toMatchObject({ code: 'timeout', uncertain: false, status: 200 });

    const caller = new AbortController();
    const pendingJson = new Http(async () => stalledBody()).json(
      '/api/v1/x',
      anything,
      { signal: caller.signal, timeout: 5000 },
    );
    setTimeout(() => caller.abort(), 5);
    await expect(pendingJson).rejects.toMatchObject({
      code: 'cancelled',
      uncertain: false,
      status: 200,
    });

    const brokenBody = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            throw new TypeError('stream reset');
          },
        }),
      );
    await expect(
      new Http(async () => brokenBody()).json('/api/v1/x', anything, {
        method: 'POST',
        body: {},
      }),
    ).rejects.toMatchObject({ code: 'network', uncertain: true, status: 200 });
    await expect(
      new Http(async () => brokenBody()).blob('/api/v1/x', 1024),
    ).rejects.toMatchObject({ code: 'network', uncertain: false, status: 200 });
  });

  it('reports gateway 502/503/504 as unavailable and reads blobs within the byte limit', async () => {
    const onUnavailable = vi.fn();
    for (const status of [502, 503, 504]) {
      const http = new Http(async () => new Response('', { status }), {
        onUnavailable,
      });
      await expect(http.json('/api/v1/x', anything)).rejects.toMatchObject({
        code: 'unavailable',
      });
    }
    expect(onUnavailable).toHaveBeenCalledTimes(3);

    const chunks = [new TextEncoder().encode('hello '), new TextEncoder().encode('world')];
    const stream = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/plain' } },
      );
    const blob = await new Http(async () => stream()).blob('/api/v1/x', 11);
    expect(blob.type).toBe('text/plain');
    await expect(blob.text()).resolves.toBe('hello world');
    await expect(
      new Http(async () => stream()).blob('/api/v1/x', 10),
    ).rejects.toMatchObject({ code: 'capacity_exceeded', uncertain: false });
  });

  it('omits empty query values', () => {
    expect(
      queryString({ a: '1', b: '', c: undefined, d: null, e: 0, f: false }),
    ).toBe('?a=1&e=0&f=false');
    expect(queryString({})).toBe('');
  });
});
