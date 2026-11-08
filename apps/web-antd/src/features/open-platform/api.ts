import type { components } from '#/api/open-platform.gen';

import { type Http, segment } from '#/shared/api/http';
import { schemaOf } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import contract from '../../../../../contracts/open-platform.openapi.json';

type Schemas = components['schemas'];
export type Application = Schemas['Application'];
export type Scope = Schemas['Scope'];
export type Policy = Schemas['Policy'];
export type ReviewInput = Schemas['ReviewInput'];

const schemas = contract.components.schemas;
const parse = {
  app: schemaOf<Application>(schemas, 'Application'),
  apps: schemaOf<Schemas['Applications']>(schemas, 'Applications'),
};

/** Scopes in contract order; each is approved separately. */
export const scopes: Scope[] = ['student_status', 'schools', 'qq_binding_status', 'qq_binding_details', 'profile', 'schedule', 'catalog', 'public_reviews'];
export const pageSize = 100;
/** Server limits for a policy, from the contract. */
export const policyLimits = { grantDays: 365, tokenMinutes: 60, dailyQuota: 1_000_000 };

/** Developer applications as reviewed by an open-platform administrator. */
export class OpenPlatformAdmin {
  constructor(private readonly http: Http) {}

  async apps(after: string, signal?: AbortSignal) {
    const page = await this.http.json('/api/v1/open-platform/admin/apps', parse.apps, { query: { after, limit: pageSize }, signal });
    // The contract omits the cursor on the last page.
    return { items: page.items, next: page.next ?? '' };
  }

  /**
   * Approve with the scopes and limits that apply, request changes, or suspend.
   * Suspending revokes existing user grants; approving again does not restore them.
   */
  review(id: string, body: ReviewInput, key: string) {
    return this.http.json(`/api/v1/open-platform/admin/apps/${segment(id)}/review`, parse.app, { method: 'POST', body, key });
  }
}

export function useOpenPlatformAdmin() {
  return new OpenPlatformAdmin(useHttp());
}
