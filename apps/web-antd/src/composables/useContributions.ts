import { onMounted, onScopeDispose, readonly, shallowRef } from 'vue';

import { type Candidates, contributionAPI, ContributionError, type Operation, type Page, type Policy, type Statistics } from '../api/contribution';

export function useContributions(admin = false, api = contributionAPI()) {
  const data = shallowRef<null | Page>(null);
  const options = shallowRef<Candidates | null>(null);
  const policy = shallowRef<null | Policy>(null);
  const statistics = shallowRef<null | Statistics>(null);
  const completed = shallowRef(false); const loading = shallowRef(false); const sending = shallowRef(false); const uncertain = shallowRef(false);
  const error = shallowRef<ContributionError['code'] | null>(null);
  const publicError = shallowRef<ContributionError['code'] | null>(null);
  const pending = shallowRef<null | Operation>(null);
  let command: AbortController | undefined, current: AbortController | undefined;
  let cursor = ''; let disposed = false; let optionCursor = '';
  async function reload(after = cursor, candidatesAfter = optionCursor) {
    if (pending.value || sending.value || disposed) return;
    current?.abort();
    const controller = new AbortController(); current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const fresh = () => !disposed && current === controller;
    loading.value = true; data.value = null; options.value = null; error.value = null;
    policy.value = null; statistics.value = null; publicError.value = null;
    // Public policy/statistics may remain available when private authorization fails.
    const publicRead = admin ? Promise.resolve() : (async () => {
      try {
        const [p, s] = await Promise.all([api.policy(controller.signal), api.statistics(controller.signal)]);
        if (controller.signal.aborted) throw new ContributionError('network');
        if (fresh()) { policy.value = p; statistics.value = s; }
      } catch (error_) { if (fresh()) publicError.value = error_ instanceof ContributionError ? error_.code : 'network'; }
    })();
    try {
      const [page, candidates] = await Promise.all([api.list(controller.signal, after, admin), admin ? Promise.resolve(null) : api.options(controller.signal, candidatesAfter)]);
      if (controller.signal.aborted) throw new ContributionError('network');
      if (fresh()) { data.value = page; options.value = candidates; cursor = after; optionCursor = candidatesAfter; }
    } catch (error_) { if (fresh()) error.value = error_ instanceof ContributionError ? error_.code : 'network'; }
    finally { await publicRead; clearTimeout(timeout); if (fresh()) loading.value = false; }
  }
  function prepare(operation: Operation) {
    if (!data.value || pending.value || loading.value || disposed) return;
    // Snapshot the body so editing a form cannot change an idempotent retry.
    pending.value = structuredClone(operation); completed.value = false; error.value = null;
  }
  function cancel() { if (!sending.value && !uncertain.value) pending.value = null; }
  async function submit() {
    if (!pending.value || sending.value || disposed) return;
    const controller = new AbortController(); const operation = pending.value; command = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    sending.value = true; error.value = null;
    let refresh = false;
    try {
      await api.execute(operation, controller.signal);
      if (controller.signal.aborted) throw new ContributionError('network', true);
      if (disposed) return;
      pending.value = null; uncertain.value = false; completed.value = true; refresh = true;
    } catch (error_) {
      if (disposed) return;
      const failure = error_ instanceof ContributionError ? error_ : new ContributionError('network', true);
      error.value = failure.code; uncertain.value = failure.uncertain;
      if (!failure.uncertain) pending.value = null;
      if (failure.code === 'unauthenticated' || failure.code === 'forbidden') { current?.abort(); current = undefined; data.value = null; options.value = null; }
    } finally { clearTimeout(timeout); sending.value = false; command = undefined; }
    if (refresh) await reload('', '');
  }
  onMounted(() => reload());
  onScopeDispose(() => { disposed = true; current?.abort(); command?.abort(); data.value = null; options.value = null; pending.value = null; });
  return { data: readonly(data), options: readonly(options), policy: readonly(policy), statistics: readonly(statistics), loading: readonly(loading), sending: readonly(sending), error: readonly(error), publicError: readonly(publicError), pending: readonly(pending), uncertain: readonly(uncertain), completed: readonly(completed), reload, prepare, cancel, submit,
    next: () => reload(data.value?.next_cursor), nextOptions: () => reload(cursor, options.value?.next_cursor), first: () => reload('', '') };
}
