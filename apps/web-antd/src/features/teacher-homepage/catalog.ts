import type { components } from '#/api/catalog.gen';

import { segment } from '#/shared/api/http';
import { schemaOf } from '#/shared/api/schema';

import contract from '../../../../../contracts/catalog.openapi.json';

export type CatalogSchemas = components['schemas'];

export function teacherSitesPath(school: string) {
  return `/api/v1/catalog/admin/schools/${segment(school)}/teacher-sites`;
}

export function parseCatalog<K extends keyof CatalogSchemas>(name: K) {
  return schemaOf<CatalogSchemas[K]>(contract.components.schemas, name);
}
