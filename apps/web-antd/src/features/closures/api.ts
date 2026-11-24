import type { components } from '#/api/session.gen';
import type { Http } from '#/shared/api/http';

import { segment } from '#/shared/api/http';
import { schemaOf } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import contract from '../../../../../contracts/session.openapi.json';

export type Closure = components['schemas']['Closure'];
export type ClosurePage = components['schemas']['ClosurePage'];
export type ClosureState = Closure['state'];
export type ClosureStep = Closure['completed_steps'][number];
export type ClosureBlocker = Exclude<Closure['blocker'], ''>;
export type SkippedModule = NonNullable<Closure['skipped_modules']>[number];

export const closureStates: readonly ClosureState[] = [
  'cooling',
  'awaiting_assets',
  'processing',
  'closed',
  'cancelled',
];

export const closureSteps: readonly ClosureStep[] = [
  'assets',
  'sessions',
  'authorizations',
  'content',
];

export const closureBlockers: readonly ClosureBlocker[] = [
  'assets_unavailable', 'assets_pending', 'sessions_unavailable', 'authorizations_unavailable', 'content_unavailable',
  'storage_draining', 'background_processing',
];

export interface ClosureFilters {
  state?: ClosureState;
  blocker?: ClosureBlocker;
  actionable?: boolean;
}

export const pageSize = 50;

const schemas = contract.components.schemas;
const parseClosure = schemaOf<Closure>(schemas, 'Closure');
const parsePage = schemaOf<ClosurePage>(schemas, 'ClosurePage');

/**
 * A closure may be resumed by an administrator only after the 7-day cooling
 * deadline has passed and while it has not reached a terminal state.
 */
export function canProcessClosure(closure: Closure, nowMs = Date.now()) {
  if (closure.state === 'closed' || closure.state === 'cancelled') return false;
  const deadline = Date.parse(closure.cooling_ends_at);
  return Number.isFinite(deadline) && deadline <= nowMs;
}

export class ClosuresAdminApi {
  constructor(private readonly http: Http) {}

  get(id: string, signal?: AbortSignal) {
    return this.http.json(
      `/api/v1/profiles/admin/closures/${segment(id)}`,
      parseClosure,
      { signal },
    );
  }

  async list(after = '', signal?: AbortSignal, filters: ClosureFilters = {}) {
    const page = await this.http.json(
      '/api/v1/profiles/admin/closures',
      parsePage,
      {
        query: { ...filters, after: after || undefined, limit: pageSize },
        signal,
      },
    );
    return {
      items: page.items,
      next: page.next_cursor ?? '',
    };
  }

  process(id: string, key: string) {
    return this.http.json(
      `/api/v1/profiles/admin/closures/${segment(id)}/process`,
      parseClosure,
      { method: 'POST', key },
    );
  }
}

export function useClosuresAdmin() {
  return new ClosuresAdminApi(useHttp());
}
