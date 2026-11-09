import type { components } from '#/api/platform-eligibility.gen';

import { type Http, segment } from '#/shared/api/http';
import { schemaOf } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import contract from '../../../../../contracts/platform-eligibility.openapi.json';

type Schemas = components['schemas'];
export type Rule = Schemas['Rule'];
export type Change = Schemas['Change'];
export type Action = Schemas['Action'];
export type Condition = Rule['conditions'][number];

const schemas = contract.components.schemas;
const parse = { rule: schemaOf<Rule>(schemas, 'Rule') };

/** Every configurable action, in the order of the platform's action catalog. */
export const actions = contract.components.schemas.Action.enum as Action[];
/** Conditions an action may require; signing in is always required by the caller. */
export const conditions = contract.components.schemas.Rule.properties.conditions.items.enum as Condition[];
/** The platform-wide default applies wherever a school has no rule of its own. */
export const everySchool = '*';

/**
 * Action eligibility rules owned by the platform. A read returns the rule in
 * effect for the school. The version is the platform's configuration revision;
 * any saved change advances it, so every rule is read again after a save.
 */
export class EligibilityAdmin {
  constructor(private readonly http: Http) {}

  rule(school: string, action: Action, signal?: AbortSignal) {
    return this.http.json(`/api/v1/platform/eligibility/${segment(school)}/${segment(action)}`, parse.rule, { signal });
  }

  save(school: string, action: Action, body: Change, key: string) {
    return this.http.json(`/api/v1/platform/eligibility/${segment(school)}/${segment(action)}`, parse.rule, { method: 'PUT', body, key });
  }
}

export function useEligibilityAdmin() {
  return new EligibilityAdmin(useHttp());
}
