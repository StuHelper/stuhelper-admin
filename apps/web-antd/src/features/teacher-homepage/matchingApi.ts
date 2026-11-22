import type { CatalogSchemas } from './catalog';

import type { operations } from '#/api/catalog.gen';
import type { Http } from '#/shared/api/http';

import { ApiError } from '#/shared/api/errors';
import { segment } from '#/shared/api/http';
import { useHttp } from '#/shared/session';

import { parseCatalog, teacherSitesPath } from './catalog';

export type ReviewSite = CatalogSchemas['TeacherHomepageReviewSite'];
export type ReviewTeacherSummary =
  CatalogSchemas['TeacherHomepageReviewTeacherSummary'];
export type SiteDecisionInput = CatalogSchemas['TeacherHomepageDecisionInput'];
export type SiteReviewQuery = NonNullable<
  operations['listTeacherHomepageReviewSites']['parameters']['query']
>;
export type TeacherReviewQuery = NonNullable<
  operations['listTeacherHomepageReviewTeachers']['parameters']['query']
>;

const sitePage = parseCatalog('TeacherHomepageReviewSitePage');
const teacherPage = parseCatalog('TeacherHomepageReviewTeacherPage');
const decisionResult = parseCatalog('TeacherHomepageDecisionResult');

export class TeacherMatchingApi {
  constructor(private readonly http: Http) {}

  decide(
    school: string,
    site: string,
    body: SiteDecisionInput,
    key: string,
  ) {
    return this.http.json(
      `${teacherSitesPath(school)}/review/sites/${segment(site)}/decision`,
      decisionResult,
      { method: 'PUT', body, key },
    );
  }

  async site(school: string, id: string, signal: AbortSignal) {
    // The list search is a substring match. Only the requested site may supply
    // the revision for a decision.
    let after = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      const page = await this.sites(
        school,
        { status: 'all', q: id, limit: 20, after },
        signal,
      );
      const match = page.items.find((item) => item.site_id === id);
      if (match || !page.next || page.items.some((item) => item.site_id > id))
        return match;
      if (after === page.next) throw new ApiError('incompatible');
      after = page.next;
    }
    throw new ApiError('capacity_exceeded');
  }

  sites(school: string, query: SiteReviewQuery, signal?: AbortSignal) {
    return this.http.json(`${teacherSitesPath(school)}/review/sites`, sitePage, {
      query,
      signal,
    });
  }

  teachers(school: string, query: TeacherReviewQuery, signal?: AbortSignal) {
    return this.http.json(
      `${teacherSitesPath(school)}/review/teachers`,
      teacherPage,
      { query, signal },
    );
  }
}

export function useTeacherMatchingApi() {
  return new TeacherMatchingApi(useHttp());
}
