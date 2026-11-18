<script setup lang="ts">
import type { CatalogObject } from './api';

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Select } from 'ant-design-vue';

import { useAcademicAdmin } from './api';

const props = defineProps<{
  admin?: boolean;
  allowClear?: boolean;
  disabled?: boolean;
  excludeId?: string;
  includeInactive?: boolean;
  inputId: string;
  kind: 'course' | 'teacher';
  modelValue?: string;
  placeholder?: string;
  schoolId: string;
}>();

const emit = defineEmits<{
  selectObject: [object: CatalogObject | undefined];
  'update:modelValue': [value: string | undefined];
}>();

const { t } = useI18n();
const api = useAcademicAdmin();
const results = shallowRef<CatalogObject[]>([]);
const chosen = shallowRef<CatalogObject>();
const loading = ref(false);
const failed = ref(false);

let controller: AbortController | undefined;
let lookupController: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let query = '';
let cursor = '';

const mergedItems = computed(() => {
  const map = new Map<string, CatalogObject>();
  if (chosen.value && chosen.value.id !== props.excludeId) {
    map.set(chosen.value.id, chosen.value);
  }
  for (const item of results.value) {
    if (item.id !== props.excludeId) map.set(item.id, item);
  }
  return [...map.values()];
});

const options = computed(() =>
  mergedItems.value.map((item) => ({
    label: item.code ? `${item.name} (${item.code})` : item.name,
    value: item.id,
  })),
);

async function load(append = false) {
  if (!props.schoolId) {
    results.value = [];
    cursor = '';
    return;
  }
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  failed.value = false;
  try {
    const page = await api.objects(
      {
        kind: props.kind,
        school_id: props.schoolId,
        q: query.trim() || undefined,
        after: append ? cursor : '',
        limit: 20,
        ...(props.includeInactive ? { include_inactive: true } : {}),
      },
      request.signal,
      props.admin,
    );
    if (controller !== request) return;
    results.value = append ? [...results.value, ...page.items] : page.items;
    cursor = page.next;
  } catch {
    if (request.signal.aborted) return;
    failed.value = true;
    if (!append) results.value = [];
  } finally {
    if (controller === request) loading.value = false;
  }
}

async function syncChosen(id?: string) {
  lookupController?.abort();
  if (!id) {
    chosen.value = undefined;
    emit('selectObject', undefined);
    return;
  }
  const existing = results.value.find((item) => item.id === id);
  if (existing) {
    chosen.value = existing;
    emit('selectObject', existing);
    return;
  }
  const request = new AbortController();
  lookupController = request;
  try {
    const found = await api.lookup([id], request.signal);
    if (lookupController !== request) return;
    const item = found.get(id);
    chosen.value = item;
    emit('selectObject', item);
  } catch {
    if (!request.signal.aborted) {
      chosen.value = undefined;
      emit('selectObject', undefined);
    }
  }
}

watch(
  [() => props.schoolId, () => props.kind],
  () => {
    query = '';
    cursor = '';
    void load();
  },
  { immediate: true },
);

watch(
  () => props.modelValue,
  (id) => {
    void syncChosen(id);
  },
  { immediate: true },
);

function search(value: string) {
  query = value;
  cursor = '';
  controller?.abort();
  controller = undefined;
  clearTimeout(timer);
  timer = setTimeout(() => void load(), 250);
}

function choose(value: unknown) {
  const id = typeof value === 'string' && value ? value : undefined;
  const object = id ? mergedItems.value.find((item) => item.id === id) : undefined;
  chosen.value = object;
  emit('update:modelValue', id);
  emit('selectObject', object);
}

function more(event: Event) {
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    cursor &&
    !loading.value &&
    target.scrollTop + target.clientHeight >= target.scrollHeight - 8
  ) {
    void load(true);
  }
}

onBeforeUnmount(() => {
  controller?.abort();
  lookupController?.abort();
  clearTimeout(timer);
});
</script>

<template>
  <div>
    <Select
      :id="inputId"
      :value="modelValue || undefined"
      :options="options"
      :allow-clear="allowClear"
      :disabled="disabled"
      :loading="loading"
      :placeholder="placeholder"
      :filter-option="false"
      show-search
      class="w-full"
      @search="search"
      @change="choose"
      @popup-scroll="more"
    />
    <Alert
      v-if="failed"
      type="error"
      role="alert"
      :message="t('page.errors.unavailable')"
      class="mt-2"
    />
  </div>
</template>
