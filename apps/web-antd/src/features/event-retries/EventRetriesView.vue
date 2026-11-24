<script setup lang="ts">
import type { components } from '#/api/session.gen';

import { computed, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Select, Space, Table } from 'ant-design-vue';

import { schemaOf } from '#/shared/api/schema';
import { useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import { useHttp, useSession } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import contract from '../../../../../contracts/session.openapi.json';

type Delivery = components['schemas']['ManualDelivery'];
type Page = components['schemas']['ManualDeliveryPage'];
type Retry = components['schemas']['ManualRetryRequest'];

const { t } = useI18n();
const format = useFormat();
const http = useHttp();
const session = useSession();
const allowed = computed(() => session.session.value?.event_retry_operator === true);
const validate = schemaOf<Page>(contract.components.schemas, 'ManualDeliveryPage');
const sources = contract.components.schemas.ManualRetryRequest.properties.source.enum;
const source = ref<Retry['source']>('reviews');
const path = '/api/v1/admin/event-retries';
const queued = ref(false);
const deliveries = usePaged<Delivery>(async (cursor, signal) => {
  const result = await http.json(path, validate, {
    query: { source: source.value, after: cursor || undefined }, signal,
  });
  return { items: result.items, next: result.next_cursor ?? '' };
});
const write = useMutation();
const locked = computed(() => write.busy.value || write.uncertain.value);
useLeaveGuard(() => locked.value ? t('page.common.leaveUncertain') : '');

watch([allowed, source], ([access]) => {
  queued.value = false;
  write.dismiss();
  if (access) void deliveries.reload();
  else deliveries.clear();
}, { immediate: true });

async function settled(result: unknown) {
  if (result === true) {
    queued.value = true;
    await deliveries.reload();
  } else if (write.error.value === 'forbidden' || write.error.value === 'unauthenticated') {
    deliveries.clear();
    await session.reload();
  }
}

async function retry(id: string) {
  const item = deliveries.items.value.find((delivery) => delivery.id === id);
  if (!item || locked.value || !allowed.value) return;
  queued.value = false;
  const request: Retry = { source: source.value, id: item.id, first_failure: item.first_failure };
  const result = await write.run(JSON.stringify(request), request, async (body, key) => {
    await http.send(path, { method: 'POST', body, key });
    return true;
  });
  await settled(result);
}

const columns = computed(() => [
  { key: 'id', dataIndex: 'id', title: t('page.eventRetries.event') },
  { key: 'first', title: t('page.eventRetries.firstFailure') },
  { key: 'attempts', title: t('page.eventRetries.attempts') },
  { key: 'code', dataIndex: 'last_error_code', title: t('page.eventRetries.code') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage :title="t('page.eventRetries.title')">
    <Alert v-if="!allowed" type="error" role="alert" :message="t('page.errors.forbidden')" />
    <Card v-else>
      <Space wrap class="mb-4">
        <label for="retry-source">{{ t('page.eventRetries.source') }}</label>
        <Select
          id="retry-source"
          v-model:value="source"
          :disabled="locked"
          :options="sources.map(value => ({ label: value, value }))"
        />
        <Button :disabled="locked" @click="deliveries.reload">{{ t('page.common.refresh') }}</Button>
      </Space>
      <MutationAlert
        :busy="write.busy.value"
        :uncertain="write.uncertain.value"
        :error="write.error.value"
        :success="queued ? t('page.eventRetries.queued') : ''" @retry="async () => settled(await write.retry())"
      />
      <LoadState
        :status="deliveries.status.value"
        :error="deliveries.error.value"
        :empty="deliveries.items.value.length === 0"
        @retry="deliveries.reload"
      >
        <Table :columns="columns" :data-source="deliveries.items.value" row-key="id" :pagination="false" :scroll="{ x: 650 }">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'first'">{{ format.dateTime(record.first_failure) }}</template>
            <template v-else-if="column.key === 'attempts'">{{ format.number(record.attempts) }}</template>
            <Button v-else-if="column.key === 'action'" :disabled="locked" @click="retry(record.id)">
              {{ t('page.common.retry') }}
            </Button>
          </template>
        </Table>
      </LoadState>
      <Button v-if="deliveries.next.value" :disabled="locked || deliveries.appending.value" @click="deliveries.loadMore">
        {{ t('page.common.loadMore') }}
      </Button>
    </Card>
  </AdminPage>
</template>
