import { inject, type InjectionKey } from 'vue';

import { sessionFetch } from './session';

// Supplied by the host during bootstrap. The transport obtains current
// credentials on each request; storage pages never persist application tokens.
export const hostFetchKey: InjectionKey<typeof fetch> = Symbol('hostFetch');

export function useHostFetch(): typeof fetch {
  return inject(hostFetchKey, sessionFetch);
}
