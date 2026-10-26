import { describe, expect, it, vi } from 'vitest';

import example from '../../../../contracts/storage-operations.example.json';
import { parseOperations, storageAPI } from './storage';

describe('storage provider contract', () => {
  it('reads the provider example without extra credential fields', () => {
    const value = structuredClone(example);
    Object.assign(value.instances[0]!, { credential_ref: 'must-not-consume' });
    expect(parseOperations(value)).toEqual(example);
  });
  it.each([
    { ...example, generated_at: '2026-10-26' },
    { ...example, instances: [{ ...example.instances[0], limit_bytes: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...example, failures: [{ ...example.failures[0], generation: -1 }] },
    { ...example, objects: Array.from({ length: 101 }, () => example.objects[0]) },
  ])('rejects malformed or unbounded responses', (value) => {
    expect(() => parseOperations(value)).toThrow('incompatible');
  });
  it.each([[401, 'unauthenticated'], [403, 'forbidden'], [409, 'conflict'], [503, 'unavailable']] as const)('maps status %i safely', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream error', { status }));
    await expect(storageAPI(fetcher).read(new AbortController().signal)).rejects.toMatchObject({ code });
  });
  it('bounds queries and keeps independent page cursors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(example));
    await storageAPI(fetcher).read(new AbortController().signal, 'object-page', 'failure-page');
    const url = new URL(String(fetcher.mock.calls[0]![0]), 'https://fixture.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '25', after: 'object-page', failures_after: 'failure-page' });
  });
  it('marks lost command responses as uncertain and never injects credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private transport details'));
    await expect(storageAPI(fetcher).execute({ kind: 'instance', id: 'instance/one', body: { action: 'pause', revision: 1 }, key: 'stable-request' }, new AbortController().signal)).rejects.toMatchObject({ code: 'network', uncertain: true });
    expect(fetcher.mock.calls[0]![0]).toContain('instance%2Fone');
    expect(fetcher.mock.calls[0]![1]?.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': 'stable-request' });
  });
});
