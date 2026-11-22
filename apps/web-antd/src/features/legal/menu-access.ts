import { readonly, ref } from 'vue';

import { Http } from '#/shared/api/http';

import { LegalApi } from './api';

/** The consent-pending session omits roles. The legal list remains accessible
 * to platform administrators so they can publish the first required version. */
export function createLegalMenuAccess(fetcher: typeof fetch) {
  const allowed = ref(false);
  const api = new LegalApi(new Http(fetcher));
  let eligible = false;
  let generation = 0;
  let probe: AbortController | undefined;

  async function check() {
    if (!eligible || probe) return;
    const controller = new AbortController();
    probe = controller;
    try {
      await api.listDocuments(0, controller.signal, 1);
      if (!controller.signal.aborted) allowed.value = true;
    } catch {
      // A failed discovery leaves the menu hidden. A successful legal request
      // from a direct URL can trigger discovery again after service recovery.
    } finally {
      if (probe === controller) probe = undefined;
    }
  }

  function reset(mayManage: boolean) {
    generation++;
    probe?.abort();
    probe = undefined;
    allowed.value = false;
    eligible = mayManage;
  }

  function changeSession(mayManage: boolean) {
    reset(mayManage);
    return check();
  }

  const transport: typeof fetch = async (input, init) => {
    const current = generation;
    const response = await fetcher(input, init);
    if (current === generation && typeof input === 'string' && input.startsWith('/api/v1/admin/legal/')) {
      if (response.status === 401 || response.status === 403) reset(eligible);
      else if (response.ok && !allowed.value) void check();
    }
    return response;
  };

  return { allowed: readonly(allowed), changeSession, transport };
}
