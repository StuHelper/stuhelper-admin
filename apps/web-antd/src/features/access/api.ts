import type { components } from '#/api/platform-admin.gen';

import { type Http, segment } from '#/shared/api/http';
import { schemaOf } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import contract from '../../../../../contracts/platform-admin.openapi.json';

type Schemas = components['schemas'];
export type Role = Schemas['AdminRole'];
export type RoleInput = Schemas['AdminRoleInput'];
export type Scope = Schemas['AdminScope'];
export type Grant = Schemas['AdminGrant'];
export type Effective = Schemas['AdminEffective'];
export type Mutation = Schemas['AdminMutation'];
export type Audit = Schemas['AdminAudit'];
export type AuditPage = Schemas['AdminAuditPage'];

const schemas = contract.components.schemas;
const parse = {
  audit: schemaOf<AuditPage>(schemas, 'AdminAuditPage'),
  effective: schemaOf<Effective>(schemas, 'AdminEffective'),
  revision: schemaOf<Schemas['AdminRevision']>(schemas, 'AdminRevision'),
  role: schemaOf<Role>(schemas, 'AdminRole'),
  roles: schemaOf<Role[]>(schemas, 'AdminRole', true),
};

/** `*` matches every value of a scope dimension; all three dimensions must match. */
export const anyScope: Scope = { school: '*', group: '*', module: '*' };

export interface AuditQuery {
  actor?: string;
  action?: string;
  from?: string;
  sources?: string[];
  target?: string;
  until?: string;
}

/**
 * Roles, grants and the combined operation log of platform administration.
 * Platform administrators hold every capability; roles grant others a set of
 * capabilities within a school, group and module scope.
 */
export class AccessAdmin {
  constructor(private readonly http: Http) {}

  /** Roles are immutable: changing capabilities means creating a role with a new ID. */
  createRole(body: RoleInput, key: string) {
    return this.http.json('/api/v1/platform/admin/roles', parse.role, { method: 'POST', body, key });
  }

  effective(subject: string, scope: Scope = anyScope, signal?: AbortSignal) {
    return this.http.json(`/api/v1/platform/admin/administrators/${segment(subject)}/effective`, parse.effective, { query: { ...scope }, signal });
  }

  grant(subject: string, body: Mutation, key: string) {
    return this.http.json(`/api/v1/platform/admin/administrators/${segment(subject)}/grants`, parse.revision, { method: 'PUT', body, key });
  }

  operations(query: AuditQuery, cursor: string, signal?: AbortSignal) {
    const { sources, ...rest } = query;
    return this.http.json('/api/v1/platform/admin/operations', parse.audit, {
      query: { ...rest, sources: sources?.length ? sources.join(',') : undefined, cursor: cursor || undefined, limit: 50 },
      signal,
    });
  }

  revoke(subject: string, body: Mutation, key: string) {
    return this.http.json(`/api/v1/platform/admin/administrators/${segment(subject)}/grants`, parse.revision, { method: 'DELETE', body, key });
  }

  role(id: string, signal?: AbortSignal) {
    return this.http.json(`/api/v1/platform/admin/roles/${segment(id)}`, parse.role, { signal });
  }

  templates(signal?: AbortSignal) {
    return this.http.json('/api/v1/platform/admin/role-templates', parse.roles, { signal });
  }
}

export function useAccessAdmin() {
  return new AccessAdmin(useHttp());
}
