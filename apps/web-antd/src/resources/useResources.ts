import { onUnmounted, ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';

import { useHostFetch } from '../api/host';
import { Client, errorCode, Mutation } from './api';
export function useResources(clear: () => void = () => {}) {
  const busy = ref(false);
  const error = ref('');
  const uncertain = ref(false);
  let alive = true;
  const lifetime = new AbortController();
  let last: (() => Promise<unknown>) | undefined;
  const client = new Client(useHostFetch(), clear);
  const mutation = new Mutation(client);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busy.value) return;
    last = action;
    busy.value = true;
    error.value = '';
    try {
      return await action();
    } catch (error_) {
      if (alive) error.value = errorCode(error_);
    } finally {
      busy.value = false;
      uncertain.value = mutation.uncertain;
    }
  }
  onBeforeRouteUpdate(() => !busy.value && !uncertain.value);
  onBeforeRouteLeave(() => !busy.value && !uncertain.value);
  onUnmounted(() => {
    alive = false;
    lifetime.abort();
  });
  return {
    client,
    mutation,
    busy,
    error,
    uncertain,
    run,
    retry: () => (last ? run(last) : Promise.resolve()),
    signal: lifetime.signal,
  };
}
