import { describe, expect, it } from 'vitest';

import moderationContract from '../../../../contracts/moderation.openapi.json';
import resourcesContract from '../../../../contracts/resources.openapi.json';
import reviewsContract from '../../../../contracts/reviews.openapi.json';
import { parseCapabilities, parseModules } from '../features/overview/api';
import { schemaOf } from '../shared/api/schema';
import { routeCapability } from '../shared/capabilities';
import { handleDemoRequest } from './server';

const parseResource = schemaOf(
  resourcesContract.components.schemas,
  'Resource',
);
const parseTasks = schemaOf(
  moderationContract.components.schemas,
  'TaskView',
  true,
);
const parseSaved = schemaOf(moderationContract.components.schemas, 'Saved');
const parseAttribution = schemaOf(
  reviewsContract.components.schemas,
  'AttributionPreview',
);

const call = async (path: string, method = 'GET', body?: unknown) => {
  const response = await handleDemoRequest(
    new URL(`http://127.0.0.1:5174${path}`),
    method,
    body ? { body: JSON.stringify(body) } : undefined,
  );
  return { status: response.status, response };
};

describe('demo server contract alignment', () => {
  it('enables all optional module route capabilities and valid module health records', async () => {
    const cap = await call('/api/v1/system/capabilities');
    expect(cap.status).toBe(200);
    const parsedCap = parseCapabilities(await cap.response.json());
    const enabled = new Set(parsedCap.capabilities);

    for (const path of [
      '/billing/refunds',
      '/qq/groups',
      '/qq-binding',
      '/open-platform',
      '/system/lookup',
    ]) {
      const req = routeCapability(path);
      expect(req && enabled.has(req)).toBe(true);
    }

    const mod = await call('/api/v1/admin/modules');
    expect(mod.status).toBe(200);
    expect(parseModules(await mod.response.json()).length).toBeGreaterThan(0);
  });

  it('returns contract-valid Resource and PDF payloads for /resources/review/', async () => {
    const tasksRes = await call(
      '/api/v1/moderation/tasks?content_kind=resource&state=waiting',
    );
    const tasks = parseTasks(await tasksRes.response.json()) as {
      submission: { object_id: string };
    }[];
    expect(tasks.length).toBeGreaterThan(0);
    const versionId = tasks[0]!.submission.object_id.replace(/^resource:/, '');

    const detail = await call(`/api/v1/resources/review/${versionId}`);
    expect(detail.status).toBe(200);
    const resource = parseResource(await detail.response.json()) as {
      proposal?: { id: string; state: string };
    };
    expect(resource.proposal?.id).toBe(versionId);
    expect(resource.proposal?.state).toBe('pending');

    const file = await call(`/api/v1/resources/review/${versionId}/file`);
    expect(file.status).toBe(200);
    expect(file.response.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('returns contract-valid policy save and review attribution preview responses', async () => {
    const saved = await call('/api/v1/moderation/policies', 'PUT', {
      school_id: 'beihang',
      kind: 'course',
      mode: 'pending',
      blocked_terms: ['spam'],
      revision: 1,
    });
    expect(parseSaved(await saved.response.json())).toEqual({ ok: true });

    const attribution = await call(
      '/api/v1/reviews/admin/entries/r1/attribution',
    );
    expect(attribution.status).toBe(200);
    expect(parseAttribution(await attribution.response.json())).toMatchObject({
      revision: 1,
      evidence_revision: 'demo-ev-1',
    });
  });
});
