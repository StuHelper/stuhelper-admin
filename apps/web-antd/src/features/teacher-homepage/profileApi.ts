import type { CatalogSchemas } from './catalog';

import type { Http } from '#/shared/api/http';

import { ApiError } from '#/shared/api/errors';
import { segment } from '#/shared/api/http';
import { useHttp } from '#/shared/session';

import { parseCatalog, teacherSitesPath } from './catalog';

export const homepagePhotoLimit = 2 * 1024 * 1024;

export async function getTeacherHomepagePhoto(
  http: Http,
  path: string,
  signal?: AbortSignal,
) {
  const photo = await http.blob(path, homepagePhotoLimit, {
    redirect: 'error',
    signal,
  });
  if (
    photo.size === 0 ||
    (photo.type !== 'image/jpeg' && photo.type !== 'image/png')
  ) {
    throw new ApiError('incompatible');
  }
  return photo;
}

export class TeacherHomepageProfileApi {
  constructor(private readonly http: Http) {}

  getControls(school: string, teacher: string, signal?: AbortSignal) {
    return this.http.json(
      `${teacherSitesPath(school)}/teachers/${segment(teacher)}/homepage`,
      parseCatalog('TeacherHomepageControlsView'),
      { signal },
    );
  }

  getSavedPhoto(teacher: string, id: string, signal?: AbortSignal) {
    return getTeacherHomepagePhoto(
      this.http,
      `/api/v1/catalog/objects/${segment(teacher)}/teacher-homepage/photos/${segment(id)}`,
      signal,
    );
  }

  setControls(
    school: string,
    teacher: string,
    body: CatalogSchemas['TeacherHomepageControlsInput'],
    key: string,
  ) {
    return this.http.json(
      `${teacherSitesPath(school)}/teachers/${segment(teacher)}/homepage`,
      parseCatalog('TeacherHomepageControlsReceipt'),
      { method: 'PUT', body, key },
    );
  }
}

export function useTeacherHomepageProfile() {
  return new TeacherHomepageProfileApi(useHttp());
}
