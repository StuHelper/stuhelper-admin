import type { operations } from '../../api/catalog.gen';
import type { CatalogSchemas } from './catalog';

import type { Http } from '#/shared/api/http';

import { ApiError } from '#/shared/api/errors';
import { segment } from '#/shared/api/http';
import { useHttp } from '#/shared/session';

import { parseCatalog, teacherSitesPath } from './catalog';
import { getTeacherHomepagePhoto } from './profileApi';

export type HomepageRequest = CatalogSchemas['TeacherHomepageRequest'];
export type RequestFilter = NonNullable<
  operations['listTeacherHomepageRequests']['parameters']['query']
>;
export type RequestDecision = CatalogSchemas['TeacherHomepageRequestDecisionInput'];

export const decisionNoteLimit = 2000;

const parseRequest = parseCatalog('TeacherHomepageRequest');
const parsePage = parseCatalog('TeacherHomepageRequestPage');

function requestPath(school: string, id: string) {
  return `${teacherSitesPath(school)}/requests/${segment(id)}`;
}

function requestFor(id: string) {
  return (value: unknown) => {
    const request = parseRequest(value);
    if (request.id !== id) throw new ApiError('incompatible');
    return request;
  };
}

export class TeacherHomepageRequestsApi {
  constructor(private readonly http: Http, private readonly imageHttp: Http = http) {}

  decide(school: string, id: string, body: RequestDecision, key: string) {
    return this.http.json(`${requestPath(school, id)}/decision`, requestFor(id), {
      method: 'PUT',
      body,
      key,
    });
  }

  get(school: string, id: string, signal?: AbortSignal) {
    return this.http.json(requestPath(school, id), requestFor(id), { signal });
  }

  list(school: string, query: RequestFilter, signal?: AbortSignal) {
    return this.http.json(`${teacherSitesPath(school)}/requests`, parsePage, {
      query,
      signal,
    });
  }

  async photo(
    school: string,
    id: string,
    contentType: CatalogSchemas['TeacherHomepagePortrait']['content_type'],
    signal?: AbortSignal,
  ) {
    const blob = await getTeacherHomepagePhoto(
      this.imageHttp,
      `${requestPath(school, id)}/photo`,
      signal,
    );
    if (blob.type !== contentType)
      throw new ApiError('incompatible');
    return blob;
  }
}

export function useTeacherHomepageRequests() {
  return new TeacherHomepageRequestsApi(useHttp(), useHttp(true));
}

export function buildRequestDecision(
  request: HomepageRequest,
  action: RequestDecision['action'] | undefined,
  note: string,
  homepageRevision?: number,
): RequestDecision | undefined {
  const value = note.trim();
  if (
    request.status !== 'pending' ||
    !action ||
    !value ||
    [...value].length > decisionNoteLimit ||
    value.includes('\0')
  ) {
    return undefined;
  }
  if (action === 'reject') {
    return { action, expected_revision: request.revision, note: value };
  }
  if (homepageRevision === undefined) return undefined;
  return {
    action,
    expected_revision: request.revision,
    expected_homepage_revision: homepageRevision,
    note: value,
  };
}
