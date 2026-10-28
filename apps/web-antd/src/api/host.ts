import { inject, type InjectionKey } from 'vue';

// Supplied by the host during bootstrap. The transport obtains current
// credentials on each request; storage pages never persist application tokens.
export const hostFetchKey: InjectionKey<typeof fetch> = Symbol('hostFetch');

export function useHostFetch(): typeof fetch {
  return inject(hostFetchKey, fetch);
}
