import type { Task } from './api';

import { onBeforeUnmount, onMounted, type Ref } from 'vue';

import { ApiError } from '#/shared/api/errors';

export interface TaskPollOptions {
  fetchTask: (id: string, signal: AbortSignal) => Promise<Task>;
  isPaused: () => boolean;
  onDenied?: () => void;
  onSettled: (task: Task) => Promise<void> | void;
  task: Ref<Task | undefined>;
}

/**
 * Poll a moderation task in `decided` state until the target module applies it
 * or reports a delivery failure, bounded to at most 20 attempts per decision.
 */
export function useTaskPoll(options: TaskPollOptions) {
  let polls = 0;
  let polling = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = new AbortController();

  async function poll() {
    const open = options.task.value;
    if (
      polling ||
      options.isPaused() ||
      open?.state !== 'decided' ||
      polls >= 20
    ) {
      return;
    }
    polling = true;
    polls++;
    try {
      const current = await options.fetchTask(open.id, stop.signal);
      if (options.task.value?.id !== open.id) return;
      options.task.value = current;
      if (current.state !== 'decided') {
        await options.onSettled(current);
      }
    } catch (error) {
      polls = 20;
      if (error instanceof ApiError && error.denied) {
        options.onDenied?.();
      }
    } finally {
      polling = false;
    }
  }

  onMounted(() => {
    timer = setInterval(() => void poll(), 3000);
  });

  onBeforeUnmount(() => {
    clearInterval(timer);
    stop.abort();
  });

  return {
    resetPolls() {
      polls = 0;
    },
  };
}
