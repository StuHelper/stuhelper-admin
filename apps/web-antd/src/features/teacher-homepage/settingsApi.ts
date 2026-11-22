import type { CatalogSchemas } from './catalog';

import type { Http } from '#/shared/api/http';

import { useHttp } from '#/shared/session';

import { parseCatalog, teacherSitesPath } from './catalog';

export type Allowlist = CatalogSchemas['TeacherHomepageAllowlist'];
export type AllowlistInput = CatalogSchemas['TeacherHomepageAllowlistInput'];
export type AllowlistField = CatalogSchemas['TeacherHomepageFieldSelector'];
export type HomepageCounts = CatalogSchemas['TeacherHomepageCounts'];

const parseAllowlist = parseCatalog('TeacherHomepageAllowlist');
const parseCounts = parseCatalog('TeacherHomepageCounts');

export class SettingsApi {
  constructor(private readonly http: Http) {}

  readAllowlist(school: string, signal?: AbortSignal) {
    return this.http.json(`${teacherSitesPath(school)}/allowlist`, parseAllowlist, {
      signal,
    });
  }

  readCounts(school: string, signal?: AbortSignal) {
    return this.http.json(
      `${teacherSitesPath(school)}/homepage-counts`,
      parseCounts,
      { signal },
    );
  }

  saveAllowlist(school: string, body: AllowlistInput, key: string) {
    return this.http.json(`${teacherSitesPath(school)}/allowlist`, parseAllowlist, {
      body,
      key,
      method: 'PUT',
    });
  }
}

export function useSettingsApi() {
  return new SettingsApi(useHttp());
}
