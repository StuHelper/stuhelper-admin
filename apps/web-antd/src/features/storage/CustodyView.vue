<script setup lang="ts">
import type { CustodyBinding } from '#/api/custody';

import { computed } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Space, Table, Tag } from 'ant-design-vue';

import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';

import { useCustody } from './useCustody';

// Custody requests of all users. Administrators may resume an original
// operation but never consent on a user's behalf or read passwords.
const { t, te } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const { data, loading, sending, error, recovery, reload, resume, recover } = useCustody(true);
const locked = computed(() => loading.value || sending.value || !!recovery.value);
const label = (key: string) => (te(key) ? t(key) : t('page.contribution.unknown'));
const columns = computed(() => [
  { key: 'id', title: t('page.custody.binding') },
  { key: 'state', title: t('page.common.status') },
  { key: 'until', title: t('page.custody.until') },
  { key: 'reason', title: t('page.custody.lastError') },
  { key: 'action', title: t('page.common.operation') },
]);
// Ant Design Vue types table rows as Record<string, any>; each row comes from this page's typed data source.
</script>

<template>
  <AdminPage :title="t('page.custody.title')" :description="t('page.custody.intro')">
    <template #extra>
      <Button :disabled="loading || sending" :loading="loading" @click="reload('')">{{ t('page.common.refresh') }}</Button>
    </template>
    <div class="flex flex-col gap-4">
      <div aria-live="polite">
        <Alert v-if="error && !recovery" type="error" show-icon role="alert" :message="errorText(error)" />
        <Alert v-if="recovery" type="warning" show-icon :message="t('page.custody.uncertain')">
          <template #action>
            <Button size="small" :disabled="loading || sending" @click="recover">{{ t('page.custody.retryRecovery') }}</Button>
          </template>
        </Alert>
      </div>
      <Card :bordered="false">
        <Table :columns="columns" :data-source="[...(data?.items ?? [])]" :pagination="false" row-key="id" size="middle" :loading="loading" :scroll="{ x: 720 }" :locale="{ emptyText: t('page.common.empty') }">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'"><span class="me-2">{{ record.adapter }}</span><bdi class="break-all font-mono text-xs">{{ record.id }}</bdi></template>
            <template v-else-if="column.key === 'state'"><Tag :color="record.state === 'ready' ? 'green' : record.state === 'pending' ? 'orange' : 'red'">{{ label(`page.custody.states.${record.state}`) }}</Tag></template>
            <template v-else-if="column.key === 'until'">{{ format.dateTime(record.authorization_expires_at) }}</template>
            <template v-else-if="column.key === 'reason'">{{ record.last_error ? label(`page.custody.reasons.${record.last_error}`) : '' }}</template>
            <template v-else-if="column.key === 'action'">
              <Button v-if="record.state === 'pending' || record.state === 'blocked'" size="small" :disabled="locked" @click="resume(record as CustodyBinding)">{{ t('page.custody.resume') }}</Button>
            </template>
          </template>
        </Table>
        <Space class="mt-4">
          <Button v-if="data?.next_cursor" :disabled="locked" @click="reload(data.next_cursor)">{{ t('page.common.next') }}</Button>
        </Space>
      </Card>
    </div>
  </AdminPage>
</template>
