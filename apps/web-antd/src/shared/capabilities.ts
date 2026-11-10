import { inject, type InjectionKey, ref } from 'vue';

import { getCapabilities } from '../features/overview/api';
import { Http } from './api/http';

/** Deployment capabilities only control presentation; APIs authorize each request. */
export function createCapabilities(fetcher: typeof fetch) {
  const status = ref<'error' | 'loading' | 'ready'>('loading');
  const names = ref<ReadonlySet<string>>(new Set());
  const has = (required: string) => status.value === 'error' || (status.value === 'ready' && names.value.has(required));
  async function load() {
    try {
      const result = await getCapabilities(new Http(fetcher));
      names.value = new Set(result.capabilities);
      status.value = 'ready';
    } catch {
      // Discovery failure keeps entries available; the server decides access.
      status.value = 'error';
    }
  }
  return { status, has, load };
}
export const capabilitiesKey: InjectionKey<ReturnType<typeof createCapabilities>> = Symbol('capabilities');
export function useCapabilities() {
  const value = inject(capabilitiesKey);
  if (!value) throw new Error('Capabilities store is not installed');
  return value;
}

/** The same mapping controls menus, direct URLs and nested group pages. */
export function routeCapability(path: string): string | undefined {
  if (path.startsWith('/billing/')) return 'billing.manage';
  if (path === '/qq/groups' || path.startsWith('/qq/groups/')) return 'groups.manage';
  if (path === '/qq-binding') return 'qq-binding.manage';
  if (path === '/open-platform') return 'open-platform.manage';
  if (path === '/system/lookup') return 'information-query.query';
  return undefined;
}
