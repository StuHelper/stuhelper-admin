import type { components } from '#/api/groups.gen';

import { type Http, segment } from '#/shared/api/http';
import { schemaOf } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import contract from '../../../../../contracts/groups.openapi.json';

type Schemas = components['schemas'];
export type GroupSummary = Schemas['GroupSummary'];
export type GroupConfig = Schemas['GroupConfig'];
export type GroupConfigInput = Schemas['GroupConfigInput'];
export type Member = Schemas['Member'];
export type Action = Schemas['Action'];
export type Report = Schemas['Report'];
export type Hit = Schemas['Hit'];
export type Blacklist = Schemas['Blacklist'];
export type CommandResult = Schemas['Result'];

/** Management commands this page sends; each kind has its own required fields in the contract. */
export type ManageCommand =
  | Schemas['BlacklistCommand']
  | Schemas['ExemptCommand']
  | Schemas['ExtendCommand']
  | Schemas['KickCommand']
  | Schemas['MuteCommand']
  | Schemas['RecheckCommand']
  | Schemas['UnblacklistCommand']
  | Schemas['UnmuteCommand']
  | Schemas['WarnCommand'];

const schemas = contract.components.schemas;
const parse = {
  actions: schemaOf<Schemas['ActionPage']>(schemas, 'ActionPage'),
  blacklist: schemaOf<Schemas['BlacklistPage']>(schemas, 'BlacklistPage'),
  config: schemaOf<GroupConfig>(schemas, 'GroupConfig'),
  groups: schemaOf<Schemas['GroupSummaryPage']>(schemas, 'GroupSummaryPage'),
  hits: schemaOf<Schemas['HitPage']>(schemas, 'HitPage'),
  members: schemaOf<Schemas['MemberPage']>(schemas, 'MemberPage'),
  reports: schemaOf<Schemas['ReportPage']>(schemas, 'ReportPage'),
  result: schemaOf<CommandResult>(schemas, 'Result'),
};
export const pageSize = 50;

/** The contract writes "no time set" as the zero instant. */
export const isSet = (value?: string) => !!value && !value.startsWith('0001-01-01');

/**
 * QQ groups served by the bot. Every read and command is authorized by the
 * server against the viewer's current group-scoped grants; a command result
 * reports the action state, and an unknown state means the bot outcome is still
 * being confirmed.
 */
export class GroupsAdmin {
  constructor(private readonly http: Http) {}

  actions(group: string, cursor: string, signal?: AbortSignal) {
    return this.list(group, 'actions', parse.actions, cursor, signal);
  }

  blacklist(group: string, cursor: string, signal?: AbortSignal) {
    return this.list(group, 'blacklist', parse.blacklist, cursor, signal);
  }

  command(group: string, body: ManageCommand, key: string) {
    return this.http.json(`/api/v1/groups/${segment(group)}/commands`, parse.result, { method: 'POST', body, key });
  }

  config(group: string, signal?: AbortSignal) {
    return this.http.json(`/api/v1/groups/${segment(group)}`, parse.config, { signal });
  }

  async groups(cursor: string, signal?: AbortSignal) {
    const page = await this.http.json('/api/v1/groups', parse.groups, { query: { cursor: cursor || undefined, limit: pageSize }, signal });
    return { items: page.items, next: page.next_cursor };
  }

  hits(group: string, cursor: string, signal?: AbortSignal) {
    return this.list(group, 'hits', parse.hits, cursor, signal);
  }

  members(group: string, cursor: string, signal?: AbortSignal) {
    return this.list(group, 'members', parse.members, cursor, signal);
  }

  reports(group: string, cursor: string, signal?: AbortSignal) {
    return this.list(group, 'reports', parse.reports, cursor, signal);
  }

  /** Sends the revision the edit started from; a moved revision fails with conflict. */
  saveConfig(group: string, body: GroupConfigInput, key: string) {
    return this.http.json(`/api/v1/groups/${segment(group)}`, parse.config, { method: 'PUT', body, key });
  }

  private async list<T>(group: string, collection: string, validate: (value: unknown) => { items: T[]; next_cursor: string }, cursor: string, signal?: AbortSignal) {
    const page = await this.http.json(`/api/v1/groups/${segment(group)}/${collection}`, validate, { query: { cursor: cursor || undefined, limit: pageSize }, signal });
    return { items: page.items, next: page.next_cursor };
  }
}

export function useGroupsAdmin() {
  return new GroupsAdmin(useHttp());
}
