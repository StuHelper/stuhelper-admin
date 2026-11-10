import type { components } from '#/api/qq-binding.gen';

import { type Http, segment } from '#/shared/api/http';
import { schemaOf } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import contract from '../../../../../contracts/qq-binding.openapi.json';

export type Status = components['schemas']['Status'];
export type Part = 'connect' | 'official' | 'onebot';
export const parts: Part[] = ['onebot', 'connect', 'official'];

const parse = { status: schemaOf<Status>(contract.components.schemas, 'Status') };

/**
 * QQ binding administration. A lookup returns the three parts with a masked QQ
 * number, never openid or unionid, and is audited. Releasing a part makes the
 * account's binding incomplete and keeps the other two parts.
 */
export class QqBindingAdmin {
  constructor(private readonly http: Http) {}

  inspect(owner: string, signal?: AbortSignal) {
    return this.http.json(`/api/v1/qq-binding/admin/accounts/${segment(owner)}`, parse.status, { signal });
  }

  release(owner: string, body: { kind: Part; reason: string; revision: number }, key: string) {
    return this.http.json(`/api/v1/qq-binding/admin/accounts/${segment(owner)}/release`, parse.status, { method: 'POST', body, key });
  }
}

export function useQqBindingAdmin() {
  return new QqBindingAdmin(useHttp());
}
