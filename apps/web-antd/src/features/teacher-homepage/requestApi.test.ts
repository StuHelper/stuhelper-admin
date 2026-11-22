import type { HomepageRequest } from './requestApi';

import { describe, expect, it } from 'vitest';

import { Http } from '#/shared/api/http';
import { Mutation } from '#/shared/api/mutation';

import {
  buildRequestDecision,
  decisionNoteLimit,
  TeacherHomepageRequestsApi,
} from './requestApi';

const pending: HomepageRequest = {
  id: 'request:1',
  teacher_id: 'teacher:1',
  kind: 'supplement',
  field: { field: 'photo' },
  value: { photo: { id: 'a'.repeat(64), content_type: 'image/png', width: 1, height: 1 } },
  message: 'Update my portrait.',
  status: 'pending',
  revision: 2,
  created_at: '2026-11-21T10:00:00Z',
};

describe('teacher homepage request decisions', () => {
  it('requires both revisions for approval and accepts a first homepage revision of zero', () => {
    expect(buildRequestDecision(pending, 'approve', 'Approve.')).toBeUndefined();
    expect(buildRequestDecision(pending, 'approve', '  Approve.  ', 0)).toEqual({
      action: 'approve',
      expected_revision: pending.revision,
      expected_homepage_revision: 0,
      note: 'Approve.',
    });
    expect(buildRequestDecision(pending, 'reject', 'Reject.', 6)).toEqual({
      action: 'reject',
      expected_revision: pending.revision,
      note: 'Reject.',
    });
  });

  it('does not build decisions for resolved requests or invalid decision notes', () => {
    expect(buildRequestDecision(pending, undefined, 'Note')).toBeUndefined();
    expect(buildRequestDecision(pending, 'reject', '  ')).toBeUndefined();
    expect(buildRequestDecision(pending, 'reject', 'note\0')).toBeUndefined();
    expect(buildRequestDecision(pending, 'reject', 'a'.repeat(decisionNoteLimit + 1))).toBeUndefined();
    expect(buildRequestDecision(pending, 'reject', '😀'.repeat(decisionNoteLimit))).toBeDefined();
    expect(buildRequestDecision({ ...pending, status: 'approved' }, 'reject', 'Note')).toBeUndefined();
  });

  it('keeps the same key and request body when retrying an approval after a lost response', async () => {
    const sent: { body: string; key: null | string }[] = [];
    const approved = {
      ...pending,
      status: 'approved',
      revision: 3,
      resolution_note: 'Approved.',
      resolved_at: '2026-11-21T10:05:00Z',
    };
    const api = new TeacherHomepageRequestsApi(new Http(async (path, options) => {
      expect(path).toBe('/api/v1/catalog/admin/schools/buaa/teacher-sites/requests/request%3A1/decision');
      expect(options?.method).toBe('PUT');
      const headers = new Headers(options?.headers);
      sent.push({ body: String(options?.body), key: headers.get('Idempotency-Key') });
      if (sent.length === 1) throw new TypeError('connection lost');
      return Response.json(approved);
    }));
    const body = buildRequestDecision(pending, 'approve', 'Approved.', 4);
    expect(body).toBeDefined();
    if (!body) throw new Error('Approval must have a decision body');

    const mutation = new Mutation();
    await expect(
      mutation.run(pending.id, body, (value, key) => api.decide('buaa', pending.id, value, key)),
    ).rejects.toMatchObject({ code: 'network', uncertain: true });
    body.note = 'Edited after connection loss.';
    await expect(mutation.retry()).resolves.toEqual(approved);

    expect(sent[0]?.key).toBeTruthy();
    expect(sent[1]).toEqual(sent[0]);
    expect(JSON.parse(sent[1]?.body ?? '')).toEqual({
      action: 'approve',
      expected_revision: 2,
      expected_homepage_revision: 4,
      note: 'Approved.',
    });
  });

  it('preserves capacity and permission errors from the Catalog when deciding a request', async () => {
    const responses = [
      Response.json({ code: 'teacher_homepage_capacity_exceeded' }, { status: 409 }),
      Response.json({ code: 'forbidden' }, { status: 403 }),
    ];
    const api = new TeacherHomepageRequestsApi(new Http(async () => {
      const response = responses.shift();
      if (!response) throw new Error('Unexpected request');
      return response;
    }));
    const body = { action: 'approve', expected_revision: 2, expected_homepage_revision: 4, note: 'Approved.' } as const;
    await expect(api.decide('buaa', pending.id, body, 'key-1')).rejects.toMatchObject({
      code: 'teacher_homepage_capacity_exceeded',
      uncertain: false,
      status: 409,
    });
    await expect(api.decide('buaa', pending.id, body, 'key-2')).rejects.toMatchObject({
      code: 'forbidden',
      denied: true,
      status: 403,
    });
  });
});

describe('teacher homepage request reads', () => {
  it('uses the scoped list cursor and opens the matching private detail', async () => {
    const api = new TeacherHomepageRequestsApi(new Http(async (path) => {
      if (String(path).includes('?')) {
        expect(path).toBe('/api/v1/catalog/admin/schools/buaa/teacher-sites/requests?status=pending&teacher_id=teacher%3A1&after=cursor-1&limit=20');
        return Response.json({ items: [pending], next: 'cursor-2', total: 2 });
      }
      expect(path).toBe('/api/v1/catalog/admin/schools/buaa/teacher-sites/requests/request%3A1');
      return Response.json(pending);
    }));
    await expect(
      api.list('buaa', { status: 'pending', teacher_id: pending.teacher_id, after: 'cursor-1', limit: 20 }),
    ).resolves.toEqual({ items: [pending], next: 'cursor-2', total: 2 });
    await expect(api.get('buaa', pending.id)).resolves.toEqual(pending);
  });

  it('reads a bounded portrait with the same session and checks its declared type', async () => {
    const api = new TeacherHomepageRequestsApi(new Http(async (path, options) => {
      expect(path).toBe('/api/v1/catalog/admin/schools/buaa/teacher-sites/requests/request%3A1/photo');
      expect(options?.credentials).toBe('same-origin');
      expect(options?.redirect).toBe('error');
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png' },
      });
    }));
    await expect(api.photo('buaa', pending.id, 'image/png')).resolves.toMatchObject({
      size: 3,
      type: 'image/png',
    });
    await expect(api.photo('buaa', pending.id, 'image/jpeg')).rejects.toMatchObject({
      code: 'incompatible',
    });
  });

  it('rejects detail or decision responses for a different request', async () => {
    const api = new TeacherHomepageRequestsApi(
      new Http(async () => Response.json({ ...pending, id: 'request:2' })),
    );
    await expect(api.get('buaa', pending.id)).rejects.toMatchObject({
      code: 'incompatible',
      uncertain: false,
    });
    await expect(
      api.decide(
        'buaa',
        pending.id,
        { action: 'reject', expected_revision: pending.revision, note: 'Rejected.' },
        'key-1',
      ),
    ).rejects.toMatchObject({ code: 'incompatible', uncertain: true });
  });
});
