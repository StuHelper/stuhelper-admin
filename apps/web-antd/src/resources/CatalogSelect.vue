<script setup lang="ts">
import { ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Input, Select, Space } from 'ant-design-vue';

import {
  type AcademicObject,
  call,
  type ObjectPage,
  query,
} from '../academic/api';
import { useHostFetch } from '../api/host';
import StatusBlock from './StatusBlock.vue';
const props = defineProps<{
  course?: string;
  disabled?: boolean;
  kind: string;
  modelValue?: string;
  required?: boolean;
  school?: string;
  term?: string;
}>();
defineEmits<{ 'update:modelValue': [value: string] }>();
const fetcher = useHostFetch();
const { t } = useI18n();
const after = ref('');
const busy = ref(false);
const error = ref('');
const items = ref<AcademicObject[]>([]);
const search = ref('');
let generation = 0;
async function load(more = false) {
  const current = ++generation;
  busy.value = true;
  error.value = '';
  try {
    const page = await call<ObjectPage>(
      'catalog',
      '/objects' +
        query({
          kind: props.kind,
          school_id: props.school,
          course_id: props.course,
          term_id: props.term,
          q: search.value,
          after: more ? after.value : '',
          limit: '100',
        }),
      'Page',
      {},
      fetcher,
    );
    if (current !== generation) return;
    items.value = more ? [...items.value, ...page.items] : page.items;
    after.value = page.next;
  } catch {
    error.value = 'unavailable';
  } finally {
    if (current === generation) busy.value = false;
  }
}
watch(
  () => [props.kind, props.school, props.course, props.term],
  () => {
    items.value = [];
    after.value = '';
    void load();
  },
  { immediate: true },
);
</script>
<template>
  <div class="resource-field">
    <label>{{ t(`page.resources.catalog.${kind}`) }}
      <Select
        :value="modelValue ?? ''"
        :disabled="disabled || busy"
        :status="required && !modelValue ? 'warning' : undefined"
        :options="[
          { value: '', label: t('page.resources.unknown') },
          ...(modelValue && !items.some((x) => x.id === modelValue) ? [{ value: modelValue, label: modelValue }] : []),
          ...items.map((item) => ({ value: item.id, label: item.name })),
        ]"
        @change="$emit('update:modelValue', String($event ?? ''))"
      />
    </label>
    <Space.Compact class="w-full">
      <Input v-model:value="search" type="search" :aria-label="t('page.resources.searchOptions')" :disabled="disabled" @press-enter.prevent="load()" />
      <Button :disabled="disabled || busy" @click="load()">{{ t('page.resources.search') }}</Button>
      <Button v-if="after" :disabled="disabled || busy" @click="load(true)">{{ t('page.resources.more') }}</Button>
    </Space.Compact>
    <StatusBlock :error="error" @retry="load()" />
  </div>
</template>
