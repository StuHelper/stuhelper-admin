<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Card, Drawer, Form, FormItem, Input, Table, Tag } from 'ant-design-vue';

import { usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';

import { useCampusId } from '../academic/campus';
import CampusPending from '../academic/CampusPending.vue';
import { localName, useResourcesApi } from './api';
import ManagePanel from './ManagePanel.vue';

// Resources within the administrator's scope, with visibility and access grants.
const { t, locale } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useResourcesApi();
const school = useCampusId();
const query = ref('');
const selected = ref('');
const panelPending = ref(false);

const rows = usePaged(async (after, signal) => {
  if (!school.value) return { items: [], next: '' };
  const page = await api.manage({ school_id: school.value, query: query.value, after }, signal);
  return { items: page.items, next: page.next_cursor };
});

watch(school, () => void rows.reload());

const guard = () => !panelPending.value || window.confirm(t('page.common.leaveUnsaved'));
useLeaveGuard(() => (panelPending.value ? t('page.common.leaveUnsaved') : ''));
function close() {
  if (guard()) selected.value = '';
}

const columns = computed(() => [
  { key: 'title', title: t('page.resources.title') },
  { key: 'category', title: t('page.resources.category') },
  { key: 'state', title: t('page.common.status') },
  { key: 'created', title: t('page.common.createdAt') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage :title="t('page.resources.manageTitle')" :description="t('page.resources.manageIntro')">
    <div class="flex flex-col gap-4">
      <Card :bordered="false">
        <Form layout="inline" class="flex flex-wrap gap-y-3" @submit.prevent="rows.reload()">
          <FormItem :label="t('page.common.keyword')" html-for="resourcesview-field-1">
            <Input id="resourcesview-field-1" v-model:value="query" :maxlength="200" allow-clear />
          </FormItem>
          <FormItem>
            <Button type="primary" html-type="submit" :disabled="!school">{{ t('page.common.search') }}</Button>
          </FormItem>
        </Form>
      </Card>
      <CampusPending v-if="!school" @ready="school = $event" />
      <Card v-else :bordered="false">
        <LoadState v-if="rows.items.value.length === 0" :status="rows.status.value" :error="rows.error.value" :empty="true" @retry="rows.reload" />
        <template v-else>
          <Table :columns="columns" :data-source="rows.items.value" :pagination="false" row-key="id" size="middle" :scroll="{ x: 720 }">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'title'">{{ (record.proposal ?? record.current)?.metadata.title }}</template>
              <template v-else-if="column.key === 'category'">{{ localName((record.proposal ?? record.current)?.category.names ?? {}, locale) }}</template>
              <template v-else-if="column.key === 'state'">
                <Tag>{{ t(`page.resources.state.${record.state}`) }}</Tag>
                <Tag v-if="record.proposal" color="orange">{{ t(`page.resources.versionState.${record.proposal.state}`) }}</Tag>
              </template>
              <template v-else-if="column.key === 'created'">{{ format.dateTime((record.proposal ?? record.current)?.created_at ?? '') }}</template>
              <template v-else-if="column.key === 'action'"><Button type="link" size="small" @click="selected = record.id">{{ t('page.common.manage') }}</Button></template>
            </template>
          </Table>
          <div class="mt-4 flex justify-center">
            <Button v-if="rows.next.value" :loading="rows.appending.value" @click="rows.loadMore">{{ t('page.common.loadMore') }}</Button>
          </div>
          <p v-if="rows.status.value === 'error'" class="text-destructive mt-2" role="alert">{{ errorText(rows.error.value) }}</p>
        </template>
      </Card>
    </div>
    <Drawer :open="!!selected" :width="720" :title="t('page.resources.manageDetail')" :mask-closable="false" destroy-on-close @close="close">
      <ManagePanel v-if="selected" :id="selected" :key="selected" @pending="panelPending = $event" @changed="rows.reload" />
    </Drawer>
  </AdminPage>
</template>
