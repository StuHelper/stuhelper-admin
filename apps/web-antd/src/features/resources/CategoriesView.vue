<script setup lang="ts">
import type { Category, CategoryWrite, Field } from './api';

import { computed, onMounted, ref } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Card, Checkbox, Drawer, Form, FormItem, Input, InputNumber, Select, Space, Switch, Table, Tag } from 'ant-design-vue';

import { snapshot } from '#/shared/api/mutation';
import { useAsync, useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { localName, useResourcesApi } from './api';
import NamesInput from './NamesInput.vue';

/**
 * Resource categories and their fields. Pages filter and group by these
 * fields, so a category never needs code changes; stable ids keep old
 * resources readable after a rename.
 */
const { t, locale } = useI18n();
const api = useResourcesApi();
const save = useMutation();
const categories = useAsync((signal) => api.categories(signal, true));
const editing = ref(false);
const existing = ref(false);
const id = ref('');
const form = ref<CategoryWrite>(blank());
const baseline = ref('');
const success = ref('');
const dirty = computed(() => editing.value && JSON.stringify([id.value, form.value]) !== baseline.value);

function blank(): CategoryWrite {
  return { revision: 0, names: {}, enabled: true, order: 0, fields: [], group_by: '' };
}
function edit(category?: Category) {
  if (dirty.value && !window.confirm(t('page.common.leaveUnsaved'))) return;
  existing.value = !!category;
  id.value = category?.id ?? '';
  form.value = category ? { revision: category.revision, names: { ...category.names }, enabled: category.enabled, order: category.order, fields: snapshot(category.fields), group_by: category.group_by } : blank();
  baseline.value = JSON.stringify([id.value, form.value]);
  success.value = '';
  editing.value = true;
}
function close() {
  if (save.busy.value || save.uncertain.value || (dirty.value && !window.confirm(t('page.common.leaveUnsaved')))) return;
  editing.value = false;
}
useLeaveGuard(() => (dirty.value || save.busy.value || save.uncertain.value ? t(save.uncertain.value ? 'page.common.leaveUncertain' : 'page.common.leaveUnsaved') : ''));onMounted(categories.reload);

function addField() {
  form.value.fields.push({ key: '', names: {}, kind: 'text', required: false, filterable: false, groupable: false, max_length: 200 });
}
// Changing the kind keeps only the limits that apply to it.
function changeKind(field: Field) {
  delete field.min;
  delete field.max;
  delete field.options;
  delete field.max_length;
  if (field.kind === 'text') field.max_length = 200;
  if (field.kind === 'choice') field.options = [{ id: '', names: {} }];
}
function removeField(index: number) {
  if (form.value.fields[index]?.key === form.value.group_by) form.value.group_by = '';
  form.value.fields.splice(index, 1);
}

async function submit() {
  const payload = snapshot(form.value);
  for (const field of payload.fields) {
    if (typeof field.min !== 'number') delete field.min;
    if (typeof field.max !== 'number') delete field.max;
  }
  if (!payload.fields.some((field) => field.key === payload.group_by && field.groupable)) payload.group_by = '';
  const result = await save.run(`category:${id.value}`, payload, (value, key) => api.putCategory(id.value, value, key));
  if (result) saved(result);
}
async function retry() {
  const result = await save.retry();
  // The retried request returns the saved category.
  if (result) saved(result as Category);
}
function saved(result: Category) {
  existing.value = true;
  form.value.revision = result.revision;
  baseline.value = JSON.stringify([id.value, form.value]);
  success.value = t('page.common.saved');
  void categories.reload();
}

const columns = computed(() => [
  { key: 'name', title: t('page.resources.categoryName') },
  { dataIndex: 'id', key: 'id', title: t('page.resources.identifier') },
  { dataIndex: 'order', key: 'order', title: t('page.resources.order') },
  { key: 'fields', title: t('page.resources.fields') },
  { key: 'enabled', title: t('page.common.status') },
  { key: 'action', title: t('page.common.operation') },
]);
// Ant Design Vue types table rows as Record<string, any>; each row comes from this page's typed data source.
</script>

<template>
  <AdminPage :title="t('page.resources.categoriesTitle')" :description="t('page.resources.categoriesIntro')">
    <template #extra>
      <Button type="primary" @click="edit()">{{ t('page.resources.newCategory') }}</Button>
    </template>
    <Card :bordered="false">
      <LoadState :status="categories.status.value" :error="categories.error.value" :empty="(categories.data.value ?? []).length === 0" @retry="categories.reload">
        <Table :columns="columns" :data-source="categories.data.value" :pagination="false" row-key="id" size="middle" :scroll="{ x: 640 }">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">{{ localName(record.names, locale) }}</template>
            <template v-else-if="column.key === 'id'"><span class="font-mono">{{ record.id }}</span></template>
            <template v-else-if="column.key === 'fields'">{{ record.fields.map((field: Field) => localName(field.names, locale) || field.key).join(', ') }}</template>
            <template v-else-if="column.key === 'enabled'"><Tag :color="record.enabled ? 'green' : 'default'">{{ t(record.enabled ? 'page.resources.enabled' : 'page.resources.disabled') }}</Tag></template>
            <template v-else-if="column.key === 'action'"><Button type="link" size="small" @click="edit(record as Category)">{{ t('page.common.edit') }}</Button></template>
          </template>
        </Table>
      </LoadState>
    </Card>

    <Drawer :open="editing" :width="760" :title="t(existing ? 'page.resources.editCategory' : 'page.resources.newCategory')" :mask-closable="false" @close="close">
      <Form layout="vertical" @submit.prevent="submit">
        <fieldset class="flex flex-col gap-2" :disabled="save.busy.value || save.uncertain.value">
          <div class="grid gap-4 md:grid-cols-3">
            <FormItem :label="t('page.resources.identifier')" :extra="t('page.resources.identifierHint')" required html-for="categoriesview-field-1">
              <Input id="categoriesview-field-1" v-model:value="id" :maxlength="128" :readonly="existing" />
            </FormItem>
            <FormItem :label="t('page.resources.order')" html-for="categoriesview-field-2">
              <InputNumber id="categoriesview-field-2" v-model:value="form.order" :min="-100000" :max="100000" :precision="0" class="w-full" />
            </FormItem>
            <FormItem :label="t('page.resources.enabled')" html-for="categoriesview-field-3">
              <Switch id="categoriesview-field-3" v-model:checked="form.enabled" />
            </FormItem>
          </div>
          <NamesInput v-model="form.names" />
          <h3 class="mt-4 font-semibold">{{ t('page.resources.fields') }}</h3>
          <Card v-for="(field, index) in form.fields" :key="index" size="small" class="mb-3">
            <div class="grid gap-4 md:grid-cols-2">
              <FormItem :label="t('page.resources.fieldKey')" required>
                <Input v-model:value="field.key" :maxlength="64" />
              </FormItem>
              <FormItem :label="t('page.resources.fieldKind')">
                <Select v-model:value="field.kind" :options="(['text', 'integer', 'choice'] as const).map((value) => ({ value, label: t(`page.resources.fieldKinds.${value}`) }))" @change="changeKind(field)" />
              </FormItem>
            </div>
            <NamesInput v-model="field.names" />
            <Space class="my-3" wrap>
              <Checkbox v-model:checked="field.required">{{ t('page.resources.required') }}</Checkbox>
              <Checkbox v-model:checked="field.filterable">{{ t('page.resources.filterable') }}</Checkbox>
              <Checkbox v-model:checked="field.groupable">{{ t('page.resources.groupable') }}</Checkbox>
            </Space>
            <div v-if="field.kind === 'integer'" class="grid gap-4 md:grid-cols-2">
              <FormItem :label="t('page.resources.min')"><InputNumber v-model:value="field.min" :precision="0" class="w-full" /></FormItem>
              <FormItem :label="t('page.resources.max')"><InputNumber v-model:value="field.max" :precision="0" class="w-full" /></FormItem>
            </div>
            <FormItem v-if="field.kind === 'text'" :label="t('page.resources.maxLength')">
              <InputNumber v-model:value="field.max_length" :min="1" :max="1000" :precision="0" />
            </FormItem>
            <div v-if="field.kind === 'choice'" class="flex flex-col gap-2">
              <h4 class="font-semibold">{{ t('page.resources.options') }}</h4>
              <Card v-for="(option, optionIndex) in field.options" :key="optionIndex" size="small">
                <FormItem :label="t('page.resources.optionId')" required>
                  <Input v-model:value="option.id" :maxlength="128" />
                </FormItem>
                <NamesInput v-model="option.names" />
                <Button class="mt-2" size="small" danger @click="field.options?.splice(optionIndex, 1)">{{ t('page.resources.removeOption') }}</Button>
              </Card>
              <Button size="small" :disabled="(field.options?.length ?? 0) >= 100" @click="field.options?.push({ id: '', names: {} })">{{ t('page.resources.addOption') }}</Button>
            </div>
            <Button class="mt-3" danger @click="removeField(index)">{{ t('page.resources.removeField') }}</Button>
          </Card>
          <Button :disabled="form.fields.length >= 20" @click="addField">{{ t('page.resources.addField') }}</Button>
          <FormItem class="mt-4" :label="t('page.resources.groupBy')" html-for="categoriesview-field-4">
            <Select id="categoriesview-field-4" v-model:value="form.group_by" :options="[{ value: '', label: t('page.resources.noGrouping') }, ...form.fields.filter((field) => field.groupable && field.key).map((field) => ({ value: field.key, label: localName(field.names, locale) || field.key }))]" />
          </FormItem>
        </fieldset>
        <MutationAlert :busy="save.busy.value" :error="save.error.value" :uncertain="save.uncertain.value" :success="success" @retry="retry" />
        <Space class="mt-4">
          <Button type="primary" html-type="submit" :loading="save.busy.value" :disabled="save.uncertain.value || !id || !form.names['zh-CN']">{{ t('page.common.save') }}</Button>
        </Space>
      </Form>
    </Drawer>
  </AdminPage>
</template>
