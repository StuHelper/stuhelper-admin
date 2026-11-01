import type { components as Catalog } from '#/api/catalog.gen';
import type { components as Moderation } from '#/api/moderation.gen';
import type { components as Reviews } from '#/api/reviews.gen';
import type { Http, Query } from '#/shared/api/http';

import { ApiError } from '#/shared/api/errors';
import { segment } from '#/shared/api/http';
import { schemaOf, validates } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import catalogContract from '../../../../../contracts/catalog.openapi.json';
import moderationContract from '../../../../../contracts/moderation.openapi.json';
import reviewsContract from '../../../../../contracts/reviews.openapi.json';

export type CatalogObject = Catalog['schemas']['Object'];
export type ObjectSummary = Catalog['schemas']['Summary'];
export type Correction = Catalog['schemas']['Correction'];
export type MergeInput = Catalog['schemas']['MergeInput'];
export type MergePreview = Catalog['schemas']['MergePreview'];
export type ObjectState = Catalog['schemas']['ObjectState'];
export type CatalogImport = Catalog['schemas']['Import'];
export type ImportPreview = Catalog['schemas']['ImportPreview'];
export type ImportResult = Catalog['schemas']['ImportResult'];
export type AdminEntry = Reviews['schemas']['AdminEntry'];
export type Presentation = Reviews['schemas']['Presentation'];
export type PresentationView = Reviews['schemas']['PresentationView'];
export type AttributionPreview = Reviews['schemas']['AttributionPreview'];
export type Task = Moderation['schemas']['TaskView'];
export type Decision = Moderation['schemas']['Decision'];
export type Policy = Moderation['schemas']['Policy'];
export type PolicyView = Moderation['schemas']['PolicyView'];
export type BatchRequest = Moderation['schemas']['BatchRequest'];
export type BatchPreview = Moderation['schemas']['BatchPreview'];
export type Submission = Moderation['schemas']['Submission'];

const catalog = catalogContract.components.schemas;
const reviews = reviewsContract.components.schemas;
const moderation = moderationContract.components.schemas;
const parse = {
  object: schemaOf<CatalogObject>(catalog, 'Object'),
  page: schemaOf<Catalog['schemas']['Page']>(catalog, 'Page'),
  summary: schemaOf<ObjectSummary>(catalog, 'Summary'),
  lookup: schemaOf<Catalog['schemas']['Lookup']>(catalog, 'Lookup'),
  mergePreview: schemaOf<MergePreview>(catalog, 'MergePreview'),
  importPreview: schemaOf<ImportPreview>(catalog, 'ImportPreview'),
  importResult: schemaOf<ImportResult>(catalog, 'ImportResult'),
  entry: schemaOf<AdminEntry>(reviews, 'AdminEntry'),
  entries: schemaOf<AdminEntry[]>(reviews, 'AdminEntry', true),
  entryPage: schemaOf<Reviews['schemas']['AdminPage']>(reviews, 'AdminPage'),
  presentation: schemaOf<PresentationView>(reviews, 'PresentationView'),
  attribution: schemaOf<AttributionPreview>(reviews, 'AttributionPreview'),
  task: schemaOf<Task>(moderation, 'TaskView'),
  tasks: schemaOf<Task[]>(moderation, 'TaskView', true),
  policy: schemaOf<PolicyView>(moderation, 'PolicyView'),
  saved: schemaOf<Moderation['schemas']['Saved']>(moderation, 'Saved'),
  batch: schemaOf<BatchPreview>(moderation, 'BatchPreview'),
};

export const pageSize = 20;
export const dimensions = [
  'recommendation',
  'quality',
  'difficulty',
  'workload',
  'grading',
] as const;

/** Validate an administrator-supplied import file against the provider schema before sending it. */
export function parseCatalogImport(text: string): CatalogImport {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError('invalid_input');
  }
  if (!validates(value, catalog.Import, catalog))
    throw new ApiError('invalid_input');
  // The value matched the provider's Import schema above.
  return value as CatalogImport;
}

/**
 * Administration requests for the catalog, review content and moderation.
 * The server checks the administrator's school scope on every request.
 */
export class AcademicAdminApi {
  constructor(private readonly http: Http) {}

  applyBatch(body: BatchRequest, key: string) {
    return this.http.json('/api/v1/moderation/tasks/batch', parse.batch, {
      method: 'POST',
      body,
      key,
    });
  }

  confirmImport(body: CatalogImport, key: string) {
    return this.http.json(
      '/api/v1/catalog/imports/confirm',
      parse.importResult,
      { method: 'POST', body, key, timeout: 60_000 },
    );
  }

  correct(id: string, body: Correction, key: string) {
    return this.http.json(
      `/api/v1/catalog/objects/${segment(id)}`,
      parse.object,
      { method: 'PATCH', body, key },
    );
  }

  decide(
    id: string,
    body: { decision: Decision; revision: number },
    key: string,
  ) {
    return this.http.json(
      `/api/v1/moderation/tasks/${segment(id)}/decisions`,
      parse.task,
      { method: 'POST', body, key },
    );
  }

  entries(query: Query, signal?: AbortSignal) {
    return this.http.json('/api/v1/reviews/admin/entries', parse.entryPage, {
      query,
      signal,
    });
  }

  entry(id: string, signal?: AbortSignal) {
    return this.http.json(
      `/api/v1/reviews/admin/entries/${segment(id)}`,
      parse.entry,
      { signal },
    );
  }

  history(id: string, query: Query, signal?: AbortSignal) {
    return this.http.json(
      `/api/v1/reviews/admin/entries/${segment(id)}/history`,
      parse.entries,
      { query, signal },
    );
  }

  async lookup(
    ids: (string | undefined)[],
    signal?: AbortSignal,
  ): Promise<Map<string, CatalogObject>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    const names = new Map<string, CatalogObject>();
    for (let start = 0; start < unique.length; start += 100) {
      const result = await this.http.json(
        '/api/v1/catalog/objects/lookup',
        parse.lookup,
        { query: { ids: unique.slice(start, start + 100).join(',') }, signal },
      );
      for (const item of result.items) names.set(item.id, item);
    }
    return names;
  }

  merge(id: string, body: MergeInput, key: string) {
    return this.http.json(
      `/api/v1/catalog/objects/${segment(id)}/merge`,
      parse.object,
      { method: 'POST', body, key },
    );
  }

  object(id: string, signal?: AbortSignal) {
    return this.http.json(
      `/api/v1/catalog/objects/${segment(id)}`,
      parse.object,
      { signal },
    );
  }

  objects(query: Query, signal?: AbortSignal) {
    return this.http.json('/api/v1/catalog/objects', parse.page, {
      query,
      signal,
    });
  }

  /** Every option for a selector, at most ten pages. */
  async options(query: Query, signal?: AbortSignal): Promise<CatalogObject[]> {
    const items: CatalogObject[] = [];
    let after = '';
    for (let page = 0; page < 10; page++) {
      const result = await this.objects(
        { ...query, limit: 100, after },
        signal,
      );
      items.push(...result.items);
      if (!result.next) return items;
      if (result.next === after) throw new ApiError('incompatible');
      after = result.next;
    }
    throw new ApiError('capacity_exceeded');
  }

  policy(query: { kind: string; school_id: string }, signal?: AbortSignal) {
    return this.http.json('/api/v1/moderation/policies', parse.policy, {
      query,
      signal,
    });
  }

  presentation(school: string, signal?: AbortSignal) {
    return this.http.json(
      '/api/v1/reviews/admin/presentation',
      parse.presentation,
      { query: { school_id: school }, signal },
    );
  }

  previewAttribution(id: string, body: { teacher_id: string }, key: string) {
    return this.http.json(
      `/api/v1/reviews/admin/entries/${segment(id)}/attribution`,
      parse.attribution,
      { method: 'POST', body, key },
    );
  }

  previewBatch(body: BatchRequest, key: string) {
    return this.http.json(
      '/api/v1/moderation/tasks/batch-preview',
      parse.batch,
      { method: 'POST', body, key },
    );
  }

  previewImport(body: CatalogImport, key: string) {
    return this.http.json(
      '/api/v1/catalog/imports/preview',
      parse.importPreview,
      { method: 'POST', body, key, timeout: 60_000 },
    );
  }

  previewMerge(id: string, body: MergeInput, key: string) {
    return this.http.json(
      `/api/v1/catalog/objects/${segment(id)}/merge-preview`,
      parse.mergePreview,
      { method: 'POST', body, key },
    );
  }

  retryTask(id: string, body: { revision: number }, key: string) {
    return this.http.json(
      `/api/v1/moderation/tasks/${segment(id)}/retry`,
      parse.task,
      { method: 'POST', body, key },
    );
  }

  savePolicy(body: Policy, key: string) {
    return this.http.json('/api/v1/moderation/policies', parse.saved, {
      method: 'PUT',
      body,
      key,
    });
  }

  savePresentation(body: Presentation, key: string) {
    return this.http.json(
      '/api/v1/reviews/admin/presentation',
      parse.presentation,
      { method: 'PUT', body, key },
    );
  }

  setState(id: string, body: ObjectState, key: string) {
    return this.http.json(
      `/api/v1/catalog/objects/${segment(id)}/state`,
      parse.object,
      { method: 'POST', body, key },
    );
  }

  submitTask(body: Submission, key: string) {
    return this.http.json('/api/v1/moderation/tasks', parse.task, {
      method: 'POST',
      body,
      key,
    });
  }

  summary(id: string, signal?: AbortSignal) {
    return this.http.json(
      `/api/v1/catalog/objects/${segment(id)}/summary`,
      parse.summary,
      { signal },
    );
  }

  task(id: string, signal?: AbortSignal) {
    return this.http.json(
      `/api/v1/moderation/tasks/${segment(id)}`,
      parse.task,
      { signal },
    );
  }

  tasks(query: Query, signal?: AbortSignal) {
    return this.http.json('/api/v1/moderation/tasks', parse.tasks, {
      query: { admin: true, ...query },
      signal,
    });
  }
}

export function useAcademicAdmin() {
  return new AcademicAdminApi(useHttp());
}

/** Cursor for endpoints that return a bare array: the last id when the page is full. */
export function arrayCursor<T>(
  rows: T[],
  id: (row: T) => string,
  size = pageSize,
) {
  const last = rows.at(-1);
  return rows.length === size && last !== undefined ? id(last) : '';
}
