<script setup lang="ts">
import type { Audit, AuditPage, AuditQuery } from './api';

import { computed, inject, onMounted, reactive, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, DatePicker, Form, FormItem, Input, Select, Table, Tag } from 'ant-design-vue';

import { usePaged } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import { sessionKey } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';

import { useAccessAdmin } from './api';

/**
 * Administration records from every module the viewer may read, merged by time.
 * When a module cannot answer, the page says which records are missing instead
 * of presenting a partial list as complete.
 */
const { t, te } = useI18n();
const format = useFormat();
const session = inject(sessionKey, undefined);
const api = useAccessAdmin();
const errorText = useErrorText();
const sources = ['platform', 'catalog', 'reviews', 'moderation', 'resources', 'verification', 'billing', 'qq-binding', 'open-platform', 'storage'];

const filter = reactive({ sources: [] as string[], actor: '', target: '', action: '', from: undefined as string | undefined, until: undefined as string | undefined });
const latestPage = shallowRef<AuditPage>();
let applied: AuditQuery = {};

function query(): AuditQuery {
  const text = (value: string) => value.trim() || undefined;
  return { sources: filter.sources.length > 0 ? [...filter.sources] : undefined, actor: text(filter.actor), target: text(filter.target), action: text(filter.action), from: filter.from, until: filter.until };
}

const records = usePaged<Audit>(
  async (cursor, signal) => {
    // The cursor is bound to the filters and the viewer's current authorization; each page is checked again.
    const page = await api.operations(applied, cursor, signal);
    if (!signal.aborted) latestPage.value = page;
    return { items: page.items, next: page.next_cursor };
  },
  {
    onDenied: () => {
      latestPage.value = undefined;
    },
  },
);

function search() {
  applied = query();
  latestPage.value = undefined;
  void records.reload();
}
watch(() => session?.state.value, (state) => {
  if (state === 'guest') {
    records.clear();
    latestPage.value = undefined;
  }
});
onMounted(search);

const resultColor: Record<string, string> = { success: 'green', denied: 'orange', failed: 'red', unknown: 'default' };
const label = (key: string, fallback: string) => (te(key) ? t(key) : fallback);
const columns = computed(() => [
  { key: 'time', title: t('page.audit.time') },
  { key: 'source', title: t('page.audit.source') },
  { key: 'action', title: t('page.audit.action') },
  { key: 'actor', title: t('page.audit.actor') },
  { key: 'target', title: t('page.audit.target') },
  { key: 'result', title: t('page.audit.result') },
]);
</script>

<template>
  <AdminPage :title="t('page.audit.title')" :description="t('page.audit.intro')">
    <div class="flex flex-col gap-4">
      <Card :bordered="false">
        <Form layout="vertical" @submit.prevent="search">
          <div class="grid gap-3 md:grid-cols-3">
            <FormItem :label="t('page.audit.source')" html-for="audit-sources">
              <Select id="audit-sources" v-model:value="filter.sources" mode="multiple" allow-clear :placeholder="t('page.audit.allSources')" :options="sources.map((value) => ({ value, label: label(`page.audit.sources.${value}`, value) }))" />
            </FormItem>
            <FormItem :label="t('page.audit.actor')" html-for="audit-actor"><Input id="audit-actor" v-model:value="filter.actor" :maxlength="2048" allow-clear /></FormItem>
            <FormItem :label="t('page.audit.target')" html-for="audit-target"><Input id="audit-target" v-model:value="filter.target" :maxlength="2048" allow-clear /></FormItem>
            <FormItem :label="t('page.audit.action')" html-for="audit-action"><Input id="audit-action" v-model:value="filter.action" :maxlength="128" allow-clear /></FormItem>
            <FormItem :label="t('page.audit.from')" html-for="audit-from"><DatePicker id="audit-from" v-model:value="filter.from" show-time value-format="YYYY-MM-DDTHH:mm:ssZ" class="w-full" /></FormItem>
            <FormItem :label="t('page.audit.until')" html-for="audit-until"><DatePicker id="audit-until" v-model:value="filter.until" show-time value-format="YYYY-MM-DDTHH:mm:ssZ" class="w-full" /></FormItem>
          </div>
          <Button type="primary" html-type="submit" :loading="records.status.value === 'loading' && !records.appending.value">{{ t('page.common.search') }}</Button>
        </Form>
      </Card>
      <Alert v-if="latestPage?.partial" type="warning" show-icon role="alert" :message="t('page.audit.partial', { modules: format.list(latestPage.missing_modules.map((value) => label(`page.audit.sources.${value}`, value))) })" />
      <Card :bordered="false">
        <LoadState v-if="records.items.value.length === 0" :status="records.status.value === 'idle' ? 'loading' : records.status.value" :error="records.error.value" :empty="true" :empty-text="t('page.audit.empty')" @retry="records.reload" />
        <template v-else>
          <Table :columns="columns" :data-source="records.items.value" :pagination="false" :row-key="(row: Audit) => `${row.source}:${row.id}`" size="small" :scroll="{ x: 900 }">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'time'">{{ format.dateTime(record.created_at) }}</template>
              <template v-else-if="column.key === 'source'">{{ label(`page.audit.sources.${record.source}`, record.source) }}</template>
              <template v-else-if="column.key === 'action'"><code class="text-xs">{{ record.action }}</code><div v-if="record.reason" class="text-muted-foreground text-xs">{{ record.reason }}</div></template>
              <template v-else-if="column.key === 'actor'"><code class="break-all text-xs">{{ record.actor }}</code></template>
              <template v-else-if="column.key === 'target'"><code class="break-all text-xs">{{ record.target }}</code></template>
              <template v-else-if="column.key === 'result'"><Tag :color="resultColor[record.result] ?? 'default'">{{ label(`page.audit.results.${record.result}`, record.result) }}</Tag></template>
            </template>
          </Table>
          <Alert v-if="records.error.value" class="mt-3" type="error" show-icon :message="errorText(records.error.value)" />
          <div class="mt-4 flex justify-center">
            <Button v-if="records.next.value" :loading="records.appending.value" @click="records.loadMore">{{ t('page.common.loadMore') }}</Button>
          </div>
        </template>
      </Card>
    </div>
  </AdminPage>
</template>
