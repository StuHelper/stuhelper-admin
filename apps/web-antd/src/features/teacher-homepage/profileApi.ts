import type { CatalogSchemas } from './catalog';

import type { Http } from '#/shared/api/http';

import { ApiError } from '#/shared/api/errors';
import { segment } from '#/shared/api/http';
import { useHttp } from '#/shared/session';

import { parseCatalog, teacherSitesPath } from './catalog';

export const homepagePhotoLimit = 2 * 1024 * 1024;

async function readImage(http: Http, path: string, limit: number, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await http.blob(path, limit, { redirect: 'follow', signal });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 429 || attempt >= 2) throw error;
      const seconds = error.retryAfter && /^\d+$/.test(error.retryAfter) ? Number(error.retryAfter) : 5;
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new ApiError('cancelled'));
        const abort = () => {
          clearTimeout(timer);
          reject(new ApiError('cancelled'));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          resolve();
        }, Math.min(60, Math.max(1, seconds)) * 1000);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }
}

export async function getTeacherHomepagePhoto(
  http: Http,
  path: string,
  signal?: AbortSignal,
) {
  const photo = await readImage(http, path, homepagePhotoLimit, signal);
  if (
    photo.size === 0 ||
    (photo.type !== 'image/jpeg' && photo.type !== 'image/png')
  ) {
    throw new ApiError('incompatible');
  }
  return photo;
}

export class TeacherHomepageProfileApi {
  constructor(private readonly http: Http, private readonly imageHttp: Http = http) {}

  async bodyImage(item: CatalogSchemas['TeacherHomepageCopiedImage'], signal?: AbortSignal) {
    const blob = await readImage(this.imageHttp, item.url, 20 * 1024 * 1024, signal);
    if (blob.size === 0 || blob.type !== item.image.content_type) throw new ApiError('incompatible');
    return blob;
  }

  async bodyImages(teacher: string, signal?: AbortSignal) {
    const page = await this.http.json(
      `/api/v1/catalog/objects/${segment(teacher)}/teacher-homepage/media`,
      parseCatalog('TeacherHomepageMediaView'), { signal },
    );
    return page.items.filter((item): item is CatalogSchemas['TeacherHomepageCopiedImage'] => 'image' in item);
  }

  getControls(school: string, teacher: string, signal?: AbortSignal) {
    return this.http.json(
      `${teacherSitesPath(school)}/teachers/${segment(teacher)}/homepage`,
      parseCatalog('TeacherHomepageControlsView'),
      { signal },
    );
  }

  getSavedPhoto(teacher: string, id: string, signal?: AbortSignal) {
    return getTeacherHomepagePhoto(
      this.imageHttp,
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

  sourcePhoto(path: string, signal?: AbortSignal) {
    return getTeacherHomepagePhoto(this.imageHttp, path, signal);
  }

  async visiblePhoto(teacher: string, signal?: AbortSignal) {
    const view = await this.http.json(
      `/api/v1/catalog/objects/${segment(teacher)}/teacher-homepage`,
      parseCatalog('TeacherHomepagePublicView'), { signal },
    );
    return view.profile?.photo;
  }
}

export function useTeacherHomepageProfile() {
  return new TeacherHomepageProfileApi(useHttp(), useHttp(true));
}
