import type { CatalogObject } from './api';

import { onMounted, ref } from 'vue';

import { errorCode } from '#/shared/api/errors';
import { ApiError } from '#/shared/api/errors';
import { useSession } from '#/shared/session';

import { useAcademicAdmin } from './api';

/** The backend session supplies the single community school configuration. */
export function chooseCampus(schools: CatalogObject[], configured: string | undefined) {
  const chosen = schools.find((row) => row.id === configured);
  if (!chosen) throw new ApiError('incompatible');
  return chosen;
}

const status = ref<'error' | 'idle' | 'loading' | 'ready'>('idle');
const failure = ref('');
const campusId = ref('');
let pending: Promise<void> | undefined;

export function useCampus() {
  const api = useAcademicAdmin();
  const session = useSession();
  function load() {
    pending ??= (async () => {
      status.value = 'loading';
      failure.value = '';
      try {
        await session.reload();
        campusId.value = chooseCampus(await api.options({ kind: 'school' }), session.session.value?.content_school_id).id;
        status.value = 'ready';
      } catch (error) {
        failure.value = errorCode(error);
        status.value = 'error';
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  }
  return { failure, id: campusId, load, status };
}

/**
 * The served university as a per-page value. It starts empty and fills after
 * mounting, so each page's existing watcher performs its first load.
 */
export function useCampusId() {
  const campus = useCampus();
  const school = ref('');
  onMounted(async () => {
    if (campus.status.value !== 'ready') await campus.load();
    school.value = campus.id.value;
  });
  return school;
}
