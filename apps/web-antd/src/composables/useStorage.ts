import type { InstanceCommand, InstanceHealth, JobFailure, Operation, Operations } from '../api/storage';

import { onMounted, onScopeDispose, readonly, shallowRef } from 'vue';

import { storageAPI, StorageError } from '../api/storage';

export function useStorage(api = storageAPI()) {
  const data = shallowRef<null | Operations>(null);
  const loading = shallowRef(false);
  const sending = shallowRef(false);
  const error = shallowRef<null | StorageError['code']>(null);
  const pending = shallowRef<null | Operation>(null);
  const uncertain = shallowRef(false);
  const completed = shallowRef(false);
  let current: AbortController | undefined;
  let command: AbortController | undefined;
  let disposed = false;
  let after = ''; let failuresAfter = '';

  async function reload(objectCursor = after, failureCursor = failuresAfter) {
    if (sending.value || pending.value || disposed) return;
    current?.abort();
    const controller = new AbortController();
    current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    loading.value = true;
    error.value = null;
    data.value = null;
    try {
      const result = await api.read(controller.signal, objectCursor, failureCursor);
      if (controller.signal.aborted) throw new StorageError('network');
      if (current !== controller || disposed) return;
      data.value = result;
      after = objectCursor; failuresAfter = failureCursor;
    } catch (error_) {
      if (current !== controller || disposed) return;
      error.value = error_ instanceof StorageError ? error_.code : 'network';
    } finally { clearTimeout(timeout); if (current === controller) loading.value = false; }
  }
  function prepareInstance(instance: InstanceHealth, action: InstanceCommand['action'], limit?: number) {
    if (!data.value || pending.value || loading.value) return;
    error.value = null; completed.value = false;
    pending.value = { kind: 'instance', id: instance.id, body: { revision: instance.revision, action, ...(action === 'quota' ? { limit_bytes: limit } : {}) }, key: crypto.randomUUID() };
  }
  function prepareJob(job: JobFailure) {
    if (!data.value || pending.value || loading.value) return;
    error.value = null; completed.value = false;
    pending.value = { kind: 'job', id: job.id, objectId: job.object_id, generation: job.generation, key: crypto.randomUUID() };
  }
  function cancel() { if (!sending.value && !uncertain.value) pending.value = null; }
  async function submit() {
    const operation = pending.value;
    if (!operation || sending.value || disposed) return;
    const controller = new AbortController();
    command = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    sending.value = true; error.value = null;
    let refresh = false;
    try {
      await api.execute(operation, controller.signal);
      if (controller.signal.aborted) throw new StorageError('network', true);
      if (disposed) return;
      pending.value = null; uncertain.value = false; completed.value = true; refresh = true;
    } catch (error_) {
      if (disposed) return;
      const failure = error_ instanceof StorageError ? error_ : new StorageError('network', true);
      error.value = failure.code;
      uncertain.value = failure.uncertain;
      if (!failure.uncertain) pending.value = null;
      if (failure.code === 'unauthenticated' || failure.code === 'forbidden') {
        current?.abort(); current = undefined; data.value = null;
      }
    } finally { clearTimeout(timeout); sending.value = false; command = undefined; }
    if (refresh) await reload();
  }
  onMounted(() => reload());
  onScopeDispose(() => { disposed = true; current?.abort(); command?.abort(); data.value = null; pending.value = null; });
  return { data: readonly(data), loading: readonly(loading), sending: readonly(sending), error: readonly(error), pending: readonly(pending), uncertain: readonly(uncertain), completed: readonly(completed), reload, prepareInstance, prepareJob, cancel, submit,
    nextObjects: () => reload(data.value?.next_cursor), nextFailures: () => reload(after, data.value?.failures_next_cursor), firstPage: () => reload('', ''),
  };
}
