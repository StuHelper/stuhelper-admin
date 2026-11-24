import type { components } from '#/api/information-query.gen';

import { type Http } from '#/shared/api/http';
import { schemaOf, validates } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import contract from '../../../../../contracts/information-query.openapi.json';

type Schemas = components['schemas'];
export type Query = Schemas['Query'];
export type Scope = Schemas['Scope'];
export type Record = Schemas['Record'];
export type Candidate = Schemas['Candidate'];
export type CandidateGroup = Schemas['CandidateGroup'];
export type Field = Schemas['Field'];
export type Result = Schemas['Result'];
export type BatchPreviewRequest = Schemas['BatchPreviewRequest'];
export type BatchPreviewResult = Schemas['BatchPreviewResult'];
export type Audit = Schemas['Audit'];
export type AuditPage = Schemas['AuditPage'];
export type Domain = Query['domains'][number];
export type Sensitive = NonNullable<Query['fields']>[number];

const schemas = contract.components.schemas;
const parse = {
  preview: schemaOf<BatchPreviewResult>(schemas, 'BatchPreviewResult'),
  audit: schemaOf<AuditPage>(schemas, 'AuditPage'),
  result: schemaOf<Result>(schemas, 'Result'),
};

export function validPurpose(value: string) {
  return validates(value.trim(), schemas.Query.properties.purpose, schemas);
}

export const domains: Domain[] = ['profiles', 'verification', 'catalog', 'reviews', 'resources', 'billing', 'groups'];
export const sensitive: Sensitive[] = ['identity', 'document', 'material', 'refund_payee'];
export const kinds: Query['kind'][] = ['name', 'student_id', 'staff_id', 'qq', 'account'];
export const pageSize = 50;

/** One person per candidate: the same account across pages stays one group. */
export const candidateKey = (candidate: Candidate) => `${candidate.source}:${candidate.account}:${candidate.changed_at}`;

/**
 * Append a page of candidate groups. The server continues a candidate's records on the
 * next page under the same candidate, so its records join the group already shown.
 */
export function mergeGroups(shown: CandidateGroup[], page: CandidateGroup[]) {
  const merged = shown.map((group) => ({ ...group, items: [...group.items] }));
  for (const group of page) {
    const existing = merged.find((item) => candidateKey(item.candidate) === candidateKey(group.candidate));
    if (existing) {
      existing.items.push(...group.items);
      existing.has_more = group.has_more;
    } else merged.push({ ...group, items: [...group.items] });
  }
  return merged;
}

/**
 * Cross-module information lookup. Names, student IDs and QQ numbers resolve to
 * candidate accounts first; same-named people stay separate candidates and a past QQ
 * binding is marked historical, never shown as the current owner. The server checks every domain, scope and
 * sensitive category against the viewer's current grants and records each query,
 * including refusals, before releasing any result. Both calls are POST reads: a
 * repeated query is safe and is recorded again.
 */
export class InformationQuery {
  constructor(private readonly http: Http) {}

  audit(scope: Scope, purpose: string, after: string, signal?: AbortSignal) {
    return this.http.json('/api/v1/information-query/audit/query', parse.audit, { method: 'POST', body: { scope, purpose, after, limit: pageSize }, signal });
  }

  preview(body: BatchPreviewRequest, signal?: AbortSignal) {
    return this.http.json('/api/v1/information-query/preview', parse.preview, { method: 'POST', body, signal });
  }

  query(body: Query, signal?: AbortSignal) {
    return this.http.json('/api/v1/information-query/query', parse.result, { method: 'POST', body, signal });
  }
}

export function useInformationQuery() {
  return new InformationQuery(useHttp());
}
