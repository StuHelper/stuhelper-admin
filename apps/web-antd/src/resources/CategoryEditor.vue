<script setup lang="ts">
import { ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Card, Checkbox, Input, InputNumber, Select, Space } from 'ant-design-vue';

import { snapshot } from './api';
import { type Category, name, type Schema, segment } from './api';
import NamesInput from './NamesInput.vue';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';
const props = defineProps<{ category?: Category }>();
const emit = defineEmits<{ pending: [value: boolean]; saved: [] }>();
const { t, locale } = useI18n();
const id = ref('');
const value = ref<Schema['CategoryWrite']>({
  revision: 0,
  names: {},
  enabled: true,
  order: 0,
  fields: [],
  group_by: '',
});
const state = useResources();
const { busy, error, uncertain } = state;
watch(
  () => props.category,
  (c) => {
    id.value = c?.id ?? '';
    value.value = c
      ? snapshot(c)
      : {
          revision: 0,
          names: {},
          enabled: true,
          order: 0,
          fields: [],
          group_by: '',
        };
    if ('id' in value.value) delete value.value.id;
  },
  { immediate: true },
);
watch([busy, uncertain], () => emit('pending', busy.value || uncertain.value));
function add() {
  value.value.fields.push({
    key: '',
    names: {},
    kind: 'text',
    required: false,
    filterable: false,
    groupable: false,
    max_length: 200,
  });
}
function mode(index: number) {
  const f = value.value.fields[index];
  if (!f) return;
  delete f.min;
  delete f.max;
  delete f.options;
  delete f.max_length;
  if (f.kind === 'text') f.max_length = 200;
  if (f.kind === 'choice') f.options = [{ id: '', names: {} }];
}
function remove(index: number) {
  const f = value.value.fields[index];
  if (f?.key === value.value.group_by) value.value.group_by = '';
  value.value.fields.splice(index, 1);
}
async function save() {
  await state.run(async () => {
    const payload = snapshot(value.value);
    for (const field of payload.fields) {
      if (typeof field.min !== 'number') delete field.min;
      if (typeof field.max !== 'number') delete field.max;
    }
    if (!payload.fields.some(field => field.key === payload.group_by && field.groupable)) payload.group_by = '';
    const result = await state.mutation.run(
      '/categories/' + segment(id.value),
      'Category',
      payload,
      'PUT',
    );
    value.value.revision = result.revision;
    emit('saved');
  });
}
</script>
<template>
  <form class="resource-form" @submit.prevent="save">
    <StatusBlock :busy="busy" :error="error" @retry="state.retry" />
    <fieldset :disabled="busy || uncertain">
      <legend>{{ t('page.resources.taxonomy') }}</legend>
      <div class="resource-grid">
        <label class="resource-field">{{ t('page.resources.identifier') }}<Input v-model:value="id" required :maxlength="128" pattern="[A-Za-z0-9_-]+" :readonly="!!category" /></label>
        <label class="resource-field">{{ t('page.resources.order') }}<InputNumber v-model:value="value.order" :min="-100000" :max="100000" class="w-full" /></label>
        <Checkbox v-model:checked="value.enabled" class="self-end">{{ t('page.resources.enabled') }}</Checkbox>
      </div>
      <NamesInput v-model="value.names" />
      <h3>{{ t('page.resources.fields') }}</h3>
      <Card v-for="(field, index) in value.fields" :key="index" size="small" class="mb-3">
        <div class="resource-form">
          <div class="resource-grid">
            <label class="resource-field">{{ t('page.resources.identifier') }}<Input v-model:value="field.key" required :maxlength="64" pattern="[a-z][a-z0-9_-]*" /></label>
            <label class="resource-field">{{ t('page.resources.fieldKind') }}
              <Select v-model:value="field.kind" :disabled="busy || uncertain" :options="['text', 'integer', 'choice'].map((kind) => ({ value: kind, label: t(`page.resources.${kind}`) }))" @change="mode(index)" />
            </label>
          </div>
          <NamesInput v-model="field.names" />
          <Space wrap>
            <Checkbox v-model:checked="field.required">{{ t('page.resources.required') }}</Checkbox>
            <Checkbox v-model:checked="field.filterable">{{ t('page.resources.filterable') }}</Checkbox>
            <Checkbox v-model:checked="field.groupable">{{ t('page.resources.groupable') }}</Checkbox>
          </Space>
          <div v-if="field.kind === 'integer'" class="resource-grid">
            <label class="resource-field">{{ t('page.resources.min') }}<InputNumber v-model:value="field.min" :min="-1000000000" :max="1000000000" class="w-full" /></label>
            <label class="resource-field">{{ t('page.resources.max') }}<InputNumber v-model:value="field.max" :min="-1000000000" :max="1000000000" class="w-full" /></label>
          </div>
          <label v-if="field.kind === 'text'" class="resource-field">{{ t('page.resources.maxLength') }}<InputNumber v-model:value="field.max_length" :min="1" :max="1000" class="w-full" /></label>
          <section v-if="field.kind === 'choice'" class="resource-form">
            <h4>{{ t('page.resources.options') }}</h4>
            <Card v-for="(option, optionIndex) in field.options" :key="optionIndex" size="small">
              <label class="resource-field">{{ t('page.resources.identifier') }}<Input v-model:value="option.id" required :maxlength="128" /></label>
              <NamesInput v-model="option.names" />
              <Button danger size="small" @click="field.options?.splice(optionIndex, 1)">{{ t('page.resources.remove') }}</Button>
            </Card>
            <Button class="justify-self-start" :disabled="(field.options?.length ?? 0) >= 100" @click="field.options?.push({ id: '', names: {} })">{{ t('page.resources.addOption') }}</Button>
          </section>
          <Button danger class="justify-self-start" @click="remove(index)">{{ t('page.resources.remove') }}</Button>
        </div>
      </Card>
      <Button class="mb-3" :disabled="value.fields.length >= 20" @click="add">{{ t('page.resources.addField') }}</Button>
      <label class="resource-field">{{ t('page.resources.groupBy') }}
        <Select v-model:value="value.group_by" :disabled="busy || uncertain" :options="[{ value: '', label: t('page.resources.noGrouping') }, ...value.fields.filter((x) => x.groupable && x.key).map((field) => ({ value: field.key, label: name(field.names, locale) || field.key }))]" />
      </label>
    </fieldset>
    <Button type="primary" html-type="submit" class="justify-self-start" :loading="busy" :disabled="value.order === null">{{ t(uncertain ? 'page.resources.retry' : 'page.resources.save') }}</Button>
  </form>
</template>
