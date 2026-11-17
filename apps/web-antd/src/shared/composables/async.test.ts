import { effectScope } from 'vue';

// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/errors';
import { useAsync, useMutation, usePaged } from './async';

describe('loading state', () => {
  it('appends pages and keeps shown rows when the next page fails', async () => {
    const scope = effectScope();
    let fail = false;
    const paged = scope.run(() =>
      usePaged(async (cursor) => {
        if (fail) throw new ApiError('network');
        return cursor
          ? { items: [3], next: '' }
          : { items: [1, 2], next: 'c2' };
      }),
    );
    if (!paged) throw new Error('scope');
    await paged.reload();
    expect(paged.items.value).toEqual([1, 2]);
    fail = true;
    await paged.loadMore();
    expect(paged.items.value).toEqual([1, 2]);
    expect(paged.error.value).toBe('network');
    fail = false;
    await paged.loadMore();
    expect(paged.items.value).toEqual([1, 2, 3]);
    expect(paged.next.value).toBe('');
    scope.stop();
  });

  it('clears private rows and triggers onDenied when access is revoked', async () => {
    const scope = effectScope();
    let denied = false;
    const onDenied = vi.fn();
    const paged = scope.run(() =>
      usePaged(
        async () => {
          if (denied) throw new ApiError('forbidden', false, 403);
          return { items: ['private'], next: 'more' };
        },
        { onDenied },
      ),
    );
    if (!paged) throw new Error('scope');
    await paged.reload();
    denied = true;
    await paged.loadMore();
    expect(paged.items.value).toEqual([]);
    expect(onDenied).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('invokes onDenied in useAsync and useMutation only on 401/403', async () => {
    const scope = effectScope();
    const asyncDenied = vi.fn();
    const mutationDenied = vi.fn();
    const single = scope.run(() =>
      useAsync(async () => {
        throw new ApiError('billing_forbidden', false, 403);
      }, { onDenied: asyncDenied }),
    );
    const write = scope.run(() => useMutation({ onDenied: mutationDenied }));
    if (!single || !write) throw new Error('scope');

    await single.reload();
    expect(asyncDenied).toHaveBeenCalledTimes(1);

    await write.run('op-1', { a: 1 }, async () => {
      throw new ApiError('conflict', false, 409);
    });
    expect(mutationDenied).not.toHaveBeenCalled();

    await write.run('op-2', { a: 2 }, async () => {
      throw new ApiError('unauthenticated', false, 401);
    });
    expect(mutationDenied).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('ignores a stale response after a newer load', async () => {
    const scope = effectScope();
    const resolvers: ((value: string) => void)[] = [];
    const value = scope.run(() =>
      useAsync(() => new Promise<string>((resolve) => resolvers.push(resolve))),
    );
    if (!value) throw new Error('scope');
    const first = value.reload();
    const second = value.reload();
    resolvers[1]?.('new');
    await second;
    resolvers[0]?.('old');
    await first;
    expect(value.data.value).toBe('new');
    scope.stop();
  });
});
