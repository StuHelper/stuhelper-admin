import type { SessionStore } from '#/shared/session';

import { effectScope, onMounted, ref, type Ref, watch } from 'vue';

import { ApiError, errorCode } from '#/shared/api/errors';
import { useSession } from '#/shared/session';

type CampusStatus = 'error' | 'idle' | 'loading' | 'ready';

interface CampusState {
  campusId: Ref<string>;
  failure: Ref<string>;
  generation: number;
  pending?: Promise<void>;
  status: Ref<CampusStatus>;
}

const stores = new WeakMap<SessionStore, CampusState>();

function getCampusState(session: SessionStore): CampusState {
  const existing = stores.get(session);
  if (existing) return existing;
  const created: CampusState = {
    campusId: ref(''),
    failure: ref(''),
    generation: 0,
    status: ref<CampusStatus>('idle'),
  };
  const scope = effectScope(true);
  scope.run(() => {
    watch(
      [
        session.state,
        () => session.session.value?.content_school_id,
        () => session.authenticatedSession.value?.consent_required,
      ],
      (
        [nextState, nextSchool, consentPending],
        [prevState, prevSchool, prevConsent],
      ) => {
        if (
          (nextState === 'guest' && prevState !== 'guest') ||
          (consentPending && !prevConsent)
        ) {
          created.generation++;
          created.pending = undefined;
          created.campusId.value = '';
          created.failure.value = consentPending ? 'consent_required' : '';
          created.status.value = consentPending ? 'error' : 'idle';
        } else if (
          nextSchool &&
          (prevSchool || prevConsent) &&
          prevSchool !== nextSchool
        ) {
          created.campusId.value = nextSchool;
          created.failure.value = '';
          created.status.value = 'ready';
        }
      },
      { flush: 'sync' },
    );
  });
  stores.set(session, created);
  return created;
}

export function useCampus() {
  const session = useSession();
  const state = getCampusState(session);

  function load() {
    if (!state.pending) {
      const current = state.generation;
      const promise = (async () => {
        state.status.value = 'loading';
        state.failure.value = '';
        try {
          await session.reload();
          if (current !== state.generation) return;
          if (session.state.value === 'guest') {
            state.campusId.value = '';
            state.failure.value = 'unauthenticated';
            state.status.value = 'error';
            return;
          }
          // The session selects the community school. The public catalog
          // applies student eligibility, while Admin APIs check staff grants.
          const school = session.session.value?.content_school_id;
          if (session.authenticatedSession.value?.consent_required) {
            throw new ApiError('consent_required');
          }
          if (!school) {
            throw new ApiError(
              session.unavailable.value ? 'unavailable' : 'incompatible',
            );
          }
          state.campusId.value = school;
          state.status.value = 'ready';
        } catch (error) {
          if (current !== state.generation) return;
          state.campusId.value = '';
          state.failure.value = errorCode(error);
          state.status.value = 'error';
        }
      })();
      const tracked = promise.finally(() => {
        if (state.pending === tracked) state.pending = undefined;
      });
      state.pending = tracked;
    }
    return state.pending;
  }

  return {
    failure: state.failure,
    id: state.campusId,
    load,
    status: state.status,
  };
}

/**
 * The served university as a per-page value. It starts empty and fills after
 * mounting, and resets automatically if the underlying session is invalidated.
 */
export function useCampusId() {
  const campus = useCampus();
  const school = ref('');
  watch(
    campus.id,
    (id) => {
      if (school.value !== id) school.value = id;
    },
    { flush: 'sync' },
  );
  onMounted(async () => {
    if (campus.status.value !== 'ready') await campus.load();
    school.value = campus.id.value;
  });
  return school;
}
