import { inject, type InjectionKey, readonly, shallowRef } from 'vue';

export interface CatalogJumpTarget {
  kind: 'course' | 'teacher';
  query: string;
}

export function createCatalogJumpStore() {
  const pending = shallowRef<CatalogJumpTarget>();

  function prepare(kind: 'course' | 'teacher', query: string) {
    pending.value = { kind, query: query.trim() };
  }

  function consume(): CatalogJumpTarget | undefined {
    const target = pending.value;
    pending.value = undefined;
    return target;
  }

  function clear() {
    pending.value = undefined;
  }

  return {
    clear,
    consume,
    pending: readonly(pending),
    prepare,
  };
}

export type CatalogJumpStore = ReturnType<typeof createCatalogJumpStore>;
export const catalogJumpKey: InjectionKey<CatalogJumpStore> =
  Symbol('stuhelper-catalog-jump');

const fallbackStore = createCatalogJumpStore();

export function useCatalogJump(): CatalogJumpStore {
  return inject(catalogJumpKey, fallbackStore);
}
