import type { CatalogObject } from './api';

import { onMounted, ref } from 'vue';

import { errorCode } from '#/shared/api/errors';
import { ApiError } from '#/shared/api/errors';

import { useAcademicAdmin } from './api';

/**
 * The platform serves one university, so pages never ask for a school. Its id
 * comes from the catalog; a deployment holding several school records names the
 * served one with VITE_STUHELPER_SCHOOL_ID instead of guessing.
 */
export function chooseCampus(schools: CatalogObject[], configured: string | undefined) {
  const chosen = configured ? schools.find((row) => row.id === configured) : (schools.length === 1 ? schools[0] : undefined);
  if (!chosen) throw new ApiError('incompatible');
  return chosen;
}

const status = ref<'error' | 'idle' | 'loading' | 'ready'>('idle');
const failure = ref('');
const campusId = ref('');
let pending: Promise<void> | undefined;

export function useCampus() {
  const api = useAcademicAdmin();
  function load() {
    pending ??= (async () => {
      status.value = 'loading';
      failure.value = '';
      try {
        campusId.value = chooseCampus(await api.options({ kind: 'school' }), import.meta.env.VITE_STUHELPER_SCHOOL_ID).id;
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
