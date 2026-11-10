<script setup lang="ts">
import type { School } from './api';

import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Select } from 'ant-design-vue';

import { useVerification } from './api';

const props = defineProps<{ disabled?: boolean; inputId: string; modelValue: string; schools: School[] }>();
const emit = defineEmits<{ select: [school: School] }>();
const { t } = useI18n();
const api = useVerification();
const results = shallowRef<School[]>();
const options = computed(() => (results.value ?? props.schools).map((school) => ({ label: school.name, value: school.id })));
const loading = ref(false);
const failed = ref(false);
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let query = '';
let cursor = '';

async function load(append = false) {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  failed.value = false;
  try {
    const page = await api.list('School', '/api/v1/verification/schools', { q: query, after: append ? cursor : '', limit: 20, signal: request.signal });
    if (controller !== request) return;
    results.value = append ? [...(results.value ?? []), ...page.items] : page.items;
    cursor = page.next;
  } catch {
    if (request.signal.aborted) return;
    failed.value = true;
    if (!append) results.value = [];
  } finally {
    if (controller === request) loading.value = false;
  }
}
function search(value: string) {
  query = value;
  cursor = '';
  controller?.abort();
  controller = undefined;
  clearTimeout(timer);
  timer = setTimeout(() => void load(), 250);
}
function choose(value: unknown) {
  if (typeof value !== 'string') return;
  const school = (results.value ?? props.schools).find((item) => item.id === value);
  if (school) emit('select', school);
}
function more(event: Event) {
  const target = event.target;
  if (target instanceof HTMLElement && cursor && !loading.value && target.scrollTop + target.clientHeight >= target.scrollHeight - 8) void load(true);
}
onBeforeUnmount(() => { controller?.abort(); clearTimeout(timer); });
</script>

<template>
  <div>
    <Select :id="inputId" :value="modelValue" :options="options" :disabled="disabled" :loading="loading" :filter-option="false" show-search class="w-full" :aria-label="t('page.common.school')" @search="search" @change="choose" @popup-scroll="more" />
    <Alert v-if="failed" type="error" role="alert" :message="t('page.errors.unavailable')" class="mt-2" />
  </div>
</template>
