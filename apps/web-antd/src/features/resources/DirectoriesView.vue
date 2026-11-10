<script setup lang="ts">
import type { Directory, DirectoryWrite } from './api';

import { computed, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Breadcrumb, BreadcrumbItem, Button, Card, Drawer, Form, FormItem, Input, Select, Space, Switch, Table, Tag } from 'ant-design-vue';

import { useAsync, useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useAcademicAdmin } from '../academic/api';
import { useCampusId } from '../academic/campus';
import CampusPending from '../academic/CampusPending.vue';
import { localName, useResourcesApi } from './api';
import NamesInput from './NamesInput.vue';

// Multi-level resource folders under a school and course. Uploaders may only
// suggest a folder; administrators organise them here.
const { t, locale } = useI18n();
const api = useResourcesApi();
const catalog = useAcademicAdmin();
const save = useMutation();
const school = useCampusId();
const trail = ref<Directory[]>([]);
const editing = ref(false);
const existing = ref(false);
const id = ref('');
const form = ref<DirectoryWrite>();
const baseline = ref('');
const success = ref('');
const parent = computed(() => trail.value.at(-1));
const dirty = computed(() => editing.value && JSON.stringify([id.value, form.value]) !== baseline.value);

const rows = usePaged(async (after, signal) => {
  if (!school.value) return { items: [], next: '' };
  const page = await api.directories({ school_id: school.value, parent_id: parent.value?.id, after }, signal);
  return { items: page.items, next: page.next_cursor };
});
const courses = useAsync((signal) => (school.value ? catalog.options({ kind: 'course', school_id: school.value }, signal) : Promise.resolve([])));
watch(school, () => {
  trail.value = [];
  editing.value = false;
  void rows.reload();
  void courses.reload();
});
useLeaveGuard(() => (dirty.value || save.busy.value || save.uncertain.value ? t(save.uncertain.value ? 'page.common.leaveUncertain' : 'page.common.leaveUnsaved') : ''));
function enter(depth: number, next?: Directory) {
  trail.value = next ? [...trail.value, next] : trail.value.slice(0, depth);
  void rows.reload();
}
function edit(row?: Directory) {
  if (dirty.value && !window.confirm(t('page.common.leaveUnsaved'))) return;
  existing.value = !!row;
  id.value = row?.id ?? crypto.randomUUID();
  form.value = row
    ? { revision: row.revision, names: { ...row.names }, school_id: row.school_id, course_id: row.course_id, parent_id: row.parent_id, enabled: row.enabled }
    : { revision: 0, names: {}, school_id: school.value, course_id: parent.value?.course_id, parent_id: parent.value?.id, enabled: true };
  baseline.value = JSON.stringify([id.value, form.value]);
  success.value = '';
  editing.value = true;
}
function close() {
  if (save.busy.value || save.uncertain.value || (dirty.value && !window.confirm(t('page.common.leaveUnsaved')))) return;
  editing.value = false;
}

async function submit() {
  if (!form.value) return;
  const result = await save.run(`directory:${id.value}`, form.value, (value, key) => api.putDirectory(id.value, value, key));
  if (result) saved(result);
}
async function retry() {
  const result = await save.retry();
  // The retried request returns the saved folder.
  if (result) saved(result as Directory);
}
function saved(result: Directory) {
  if (form.value) form.value.revision = result.revision;
  existing.value = true;
  baseline.value = JSON.stringify([id.value, form.value]);
  success.value = t('page.common.saved');
  void rows.reload();
}

const courseName = (value?: string) => (value ? (courses.data.value?.find((item) => item.id === value)?.name ?? value) : t('page.resources.allCourses'));
const columns = computed(() => [
  { key: 'name', title: t('page.resources.folderName') },
  { key: 'course', title: t('page.resources.course') },
  { key: 'enabled', title: t('page.common.status') },
  { key: 'action', title: t('page.common.operation') },
]);
// Ant Design Vue types table rows as Record<string, any>; each row comes from this page's typed data source.
</script>

<template>
  <AdminPage :title="t('page.resources.directoriesTitle')" :description="t('page.resources.directoriesIntro')">
    <div class="flex flex-col gap-4">
      <CampusPending v-if="!school" @ready="school = $event" />
      <Card v-else :bordered="false">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Breadcrumb>
            <BreadcrumbItem><a href="#" @click.prevent="enter(0)">{{ t('page.resources.rootFolder') }}</a></BreadcrumbItem>
            <BreadcrumbItem v-for="(item, index) in trail" :key="item.id"><a href="#" @click.prevent="enter(index + 1)">{{ localName(item.names, locale) }}</a></BreadcrumbItem>
          </Breadcrumb>
          <Button type="primary" @click="edit()">{{ t('page.resources.newFolder') }}</Button>
        </div>
        <LoadState v-if="rows.items.value.length === 0" :status="rows.status.value" :error="rows.error.value" :empty="true" :empty-text="t('page.resources.noFolders')" @retry="rows.reload" />
        <template v-else>
          <Table :columns="columns" :data-source="rows.items.value" :pagination="false" row-key="id" size="middle" :scroll="{ x: 560 }">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'"><a href="#" @click.prevent="enter(trail.length, record as Directory)">{{ localName(record.names, locale) }}</a></template>
              <template v-else-if="column.key === 'course'">{{ courseName(record.course_id) }}</template>
              <template v-else-if="column.key === 'enabled'"><Tag :color="record.enabled ? 'green' : 'default'">{{ t(record.enabled ? 'page.resources.enabled' : 'page.resources.disabled') }}</Tag></template>
              <template v-else-if="column.key === 'action'"><Button type="link" size="small" @click="edit(record as Directory)">{{ t('page.common.edit') }}</Button></template>
            </template>
          </Table>
          <div class="mt-4 flex justify-center">
            <Button v-if="rows.next.value" :loading="rows.appending.value" @click="rows.loadMore">{{ t('page.common.loadMore') }}</Button>
          </div>
        </template>
      </Card>
    </div>

    <Drawer :open="editing" :width="640" :title="t(existing ? 'page.resources.editFolder' : 'page.resources.newFolder')" :mask-closable="false" @close="close">
      <Form v-if="form" layout="vertical" @submit.prevent="submit">
        <fieldset class="flex flex-col gap-2" :disabled="save.busy.value || save.uncertain.value">
          <FormItem :label="t('page.resources.identifier')" html-for="directoriesview-field-1">
            <Input id="directoriesview-field-1" v-model:value="id" :maxlength="128" :readonly="existing" />
          </FormItem>
          <NamesInput v-model="form.names" />
          <FormItem :label="t('page.resources.course')" html-for="directoriesview-field-2">
            <Select id="directoriesview-field-2" v-model:value="form.course_id" :disabled="existing" allow-clear show-search option-filter-prop="label" :placeholder="t('page.resources.allCourses')" :options="(courses.data.value ?? []).map((item) => ({ value: item.id, label: item.name }))" />
          </FormItem>
          <FormItem :label="t('page.resources.parentFolder')" html-for="directoriesview-field-3">
            <Input id="directoriesview-field-3" :value="parent ? localName(parent.names, locale) : t('page.resources.rootFolder')" disabled />
          </FormItem>
          <FormItem :label="t('page.resources.enabled')" html-for="directoriesview-field-4">
            <Switch id="directoriesview-field-4" v-model:checked="form.enabled" />
          </FormItem>
        </fieldset>
        <MutationAlert :busy="save.busy.value" :error="save.error.value" :uncertain="save.uncertain.value" :success="success" @retry="retry" />
        <Space class="mt-4">
          <Button type="primary" html-type="submit" :loading="save.busy.value" :disabled="save.uncertain.value || !form.names['zh-CN']">{{ t('page.common.save') }}</Button>
        </Space>
      </Form>
    </Drawer>
  </AdminPage>
</template>
