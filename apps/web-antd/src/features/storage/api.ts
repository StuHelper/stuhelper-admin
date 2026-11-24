import type { components } from '#/api/storage.gen';

export type Operations = components['schemas']['Operations'];
export type InstanceHealth = components['schemas']['InstanceHealth'];
export type JobFailure = components['schemas']['JobFailure'];
export type InstanceCommand = components['schemas']['InstanceCommand'];
export type Operation =
  | { body: InstanceCommand; id: string; key: string; kind: 'instance'; }
  | { generation: number; id: string; key: string; kind: 'job'; objectId: string; };

type ErrorCode = 'conflict' | 'forbidden' | 'incompatible' | 'invalid' | 'network' | 'unauthenticated' | 'unavailable';
export class StorageError extends Error {
  constructor(public readonly code: ErrorCode, public readonly uncertain = false) { super(code); }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new StorageError('incompatible');
  return value as Record<string, unknown>; // An object is established above; every consumed field is validated below.
}
function text(value: unknown, maximum = 256): string {
  if (typeof value !== 'string' || value.length > maximum) throw new StorageError('incompatible');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new StorageError('incompatible');
  return value;
}
function date(value: unknown): string {
  const result = text(value);
  if (!/(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) throw new StorageError('incompatible');
  return result;
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 100) throw new StorageError('incompatible');
  return value.map((item: unknown) => parse(item));
}
function instance(value: unknown): InstanceHealth {
  const v = record(value);
  let consent: InstanceHealth['trust_consent'];
  if (v.trust_consent !== undefined) {
    const c = record(v.trust_consent);
    const source = c.source;
    if (source !== 'owner_session' && source !== 'confirmed_by_owner') throw new StorageError('incompatible');
    const classes = list(c.classes, (k) => {
      if (k !== 'quarantine' && k !== 'restricted') throw new StorageError('incompatible');
      return k;
    });
    consent = { scope: text(c.scope), until: date(c.until), recorded_at: date(c.recorded_at), source, classes };
  }
  if ((v.trusted !== undefined && typeof v.trusted !== 'boolean') || (v.capacity_warning !== undefined && typeof v.capacity_warning !== 'boolean')) throw new StorageError('incompatible');
  return { adapter: v.adapter === undefined ? undefined : text(v.adapter), account_hint: v.account_hint === undefined ? undefined : text(v.account_hint,128),
    trusted: v.trusted, capacity_warning: v.capacity_warning, trust_consent: consent, id: text(v.id), state: text(v.state), reason: text(v.reason), revision: integer(v.revision), limit_bytes: integer(v.limit_bytes), used_bytes: integer(v.used_bytes), reserved_bytes: integer(v.reserved_bytes), available_bytes: integer(v.available_bytes), authorization_expires_at: date(v.authorization_expires_at), quota_expires_at: date(v.quota_expires_at) };
}
function job(value: unknown): JobFailure {
  const v = record(value);
  return { id: text(v.id), object_id: text(v.object_id), ...(v.replica_id === undefined ? {} : { replica_id: text(v.replica_id) }), kind: text(v.kind), state: text(v.state), generation: integer(v.generation), attempts: integer(v.attempts), error_code: text(v.error_code), next_attempt: date(v.next_attempt) };
}
export function parseOperations(value: unknown): Operations {
  const v = record(value); const jobs = record(v.jobs); const totals = record(v.object_totals);
  const intake = v.intake === undefined ? [] : list(v.intake, (entry) => {
    const row = record(entry);
    const mode = row.mode;
    if (mode !== 'paused' && mode !== 'bhpan' && mode !== 'mixed' && mode !== 'cos_only') throw new StorageError('incompatible');
    return { scope: text(row.scope), class: text(row.class), mode, contribution_accounts: integer(row.contribution_accounts), max_file_bytes: integer(row.max_file_bytes), reason: row.reason === undefined ? undefined : text(row.reason) } satisfies NonNullable<Operations['intake']>[number];
  });
  return { intake,
    generated_at: date(v.generated_at), instances: list(v.instances, instance), failures: list(v.failures, job),
    objects: list(v.objects, (value) => { const o = record(value); return { id: text(o.id), state: text(o.state), healthy: integer(o.healthy), desired: integer(o.desired), missing: integer(o.missing), reason: text(o.reason) }; }),
    object_totals: { pending: integer(totals.pending), ready: integer(totals.ready), degraded: integer(totals.degraded), unavailable: integer(totals.unavailable), deleting: integer(totals.deleting) },
    jobs: { pending: integer(jobs.pending), running: integer(jobs.running), blocked: integer(jobs.blocked) },
    next_cursor: text(v.next_cursor), failures_next_cursor: text(v.failures_next_cursor),
  };
}

// The host supplies authentication through its normal same-origin transport.
// This client never fabricates identities or stores tokens. The backend enforces grants.
export function storageAPI(fetcher: typeof fetch = fetch) {
  async function request(path: string, signal: AbortSignal, body?: object, key?: string): Promise<unknown> {
    const mutation = body !== undefined;
    let response: Response;
    try {
      response = await fetcher(path, { signal, credentials: 'same-origin', cache: 'no-store', method: mutation ? 'POST' : 'GET', headers: mutation ? { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': key ?? '' } : { Accept: 'application/json' }, body: mutation ? JSON.stringify(body) : undefined });
    } catch { throw new StorageError('network', mutation); }
    if (!response.ok) {
      if (response.status === 401) throw new StorageError('unauthenticated');
      if (response.status === 403) throw new StorageError('forbidden');
      if (response.status === 409 || response.status === 404) throw new StorageError('conflict');
      if (response.status === 400) throw new StorageError('invalid');
      throw new StorageError('unavailable', mutation);
    }
    try { return await response.json(); } catch { throw new StorageError('incompatible', mutation); }
  }
  return {
    async read(signal: AbortSignal, after = '', failuresAfter = ''): Promise<Operations> {
      const query = new URLSearchParams({ limit: '25', after, failures_after: failuresAfter });
      return parseOperations(await request(`/api/v1/storage/operations?${query}`, signal));
    },
    async execute(operation: Operation, signal: AbortSignal): Promise<void> {
      const id = encodeURIComponent(operation.id);
      const path = operation.kind === 'instance' ? `/api/v1/storage/operations/instances/${id}/commands` : `/api/v1/storage/operations/objects/${encodeURIComponent(operation.objectId)}/jobs/${id}/retry`;
      const value = await request(path, signal, operation.kind === 'instance' ? operation.body : { generation: operation.generation }, operation.key);
      try { if (operation.kind === 'instance') instance(value); else job(value); }
      catch { throw new StorageError('incompatible', true); }
    },
  };
}
