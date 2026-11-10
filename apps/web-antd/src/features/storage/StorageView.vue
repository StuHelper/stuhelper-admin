<script setup lang="ts">
import type { InstanceHealth, JobFailure } from './api';

import { computed, ref } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Form, FormItem, Input, Modal, Space, Statistic, Table, TabPane, Tabs, Tag } from 'ant-design-vue';

import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';

import { useStorage } from './useStorage';

/**
 * Storage operations: instance capacity and commands, objects missing
 * replicas, and blocked background jobs. Every command is confirmed first and
 * an unknown outcome can only be retried with the original request.
 */
const { t, te } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const { data, loading, sending, error, pending, uncertain, completed, reload, prepareInstance, prepareJob, cancel, submit, nextObjects, nextFailures, firstPage } = useStorage();
const limits = ref<Record<string, string>>({});
const tab = ref('instances');
const locked = computed(() => loading.value || sending.value || pending.value !== null);
const label = (key: string) => (te(key) ? t(key) : t('page.storage.unknown'));
const confirmation = computed(() => (pending.value ? t('page.storage.confirmAction', { action: t(`page.storage.actions.${pending.value.kind === 'job' ? 'retry' : pending.value.body.action}`) }) : ''));
// A quota may not drop below what is already used or reserved.
function quota(instance: InstanceHealth) {
  const raw = limits.value[instance.id] ?? String(instance.limit_bytes);
  const limit = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(limit) && limit >= instance.used_bytes + instance.reserved_bytes ? limit : undefined;
}
const objectColumns = computed(() => [
  { key: 'id', title: t('page.storage.objectIdLabel') },
  { key: 'state', title: t('page.common.status') },
  { key: 'replicas', title: t('page.storage.replicasLabel') },
  { key: 'reason', title: t('page.storage.reason') },
]);
const failureColumns = computed(() => [
  { key: 'id', title: t('page.storage.jobId') },
  { key: 'state', title: t('page.common.status') },
  { key: 'attempts', title: t('page.storage.attemptsLabel') },
  { key: 'error', title: t('page.storage.errorCodeLabel') },
  { key: 'next', title: t('page.storage.nextAttemptLabel') },
  { key: 'action', title: t('page.common.operation') },
]);
// Ant Design Vue types table rows as Record<string, any>; each row comes from this page's typed data source.
</script>

<template>
  <AdminPage :title="t('page.storage.title')" :description="t('page.storage.description')">
    <template #extra>
      <Space>
        <Button :disabled="locked" :loading="loading" @click="reload()">{{ t('page.common.refresh') }}</Button>
        <Button :disabled="locked" @click="firstPage">{{ t('page.common.firstPage') }}</Button>
      </Space>
    </template>
    <div class="flex flex-col gap-4">
      <div aria-live="polite">
        <Alert v-if="error && !pending" type="error" show-icon role="alert" :message="errorText(error)" />
        <Alert v-else-if="completed" type="success" show-icon role="status" :message="t('page.storage.completed')" />
      </div>
      <Card v-if="loading && !data" :bordered="false" :loading="true" />
      <template v-if="data">
        <Card :bordered="false">
          <div class="grid gap-4 sm:grid-cols-3">
            <Statistic v-for="(value, key) in data.jobs" :key="key" :title="label(`page.storage.jobStates.${String(key)}`)" :value="format.number(value)" />
          </div>
          <p class="text-muted-foreground mt-3 text-sm">{{ t('page.storage.updated', { time: format.dateTime(data.generated_at) }) }}</p>
        </Card>
        <Card :bordered="false">
          <Tabs v-model:active-key="tab">
            <TabPane key="instances" :tab="t('page.storage.instances')">
              <p v-if="data.instances.length === 0" class="text-muted-foreground">{{ t('page.common.empty') }}</p>
              <div class="grid gap-4 xl:grid-cols-2">
                <article v-for="instance in data.instances" :key="instance.id" class="rounded border p-4">
                  <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 class="break-all font-mono text-sm font-semibold"><bdi>{{ instance.id }}</bdi></h2>
                    <Tag :color="instance.state === 'active' ? 'green' : instance.state === 'revoked' ? 'red' : 'orange'">{{ label(`page.storage.states.${instance.state}`) }}</Tag>
                  </header>
                  <p v-if="instance.reason && te(`page.storage.reasons.${instance.reason}`)" class="mb-2 text-sm">{{ t(`page.storage.reasons.${instance.reason}`) }}</p>
                  <div class="grid grid-cols-2 gap-3">
                    <Statistic :title="t('page.storage.limit')" :value="format.bytes(instance.limit_bytes)" />
                    <Statistic :title="t('page.storage.used')" :value="format.bytes(instance.used_bytes)" />
                    <Statistic :title="t('page.storage.reserved')" :value="format.bytes(instance.reserved_bytes)" />
                    <Statistic :title="t('page.storage.available')" :value="format.bytes(instance.available_bytes)" />
                  </div>
                  <p class="text-muted-foreground mt-3 text-sm">{{ t('page.storage.authorizationExpiry', { time: format.dateTime(instance.authorization_expires_at) }) }}</p>
                  <Space class="mt-3" wrap>
                    <Button v-if="instance.state === 'active'" :disabled="locked" @click="prepareInstance(instance, 'pause')">{{ t('page.storage.actions.pause') }}</Button>
                    <Button v-if="instance.state === 'paused'" :disabled="locked" @click="prepareInstance(instance, 'resume')">{{ t('page.storage.actions.resume') }}</Button>
                    <Button v-if="['active', 'paused'].includes(instance.state)" :disabled="locked" @click="prepareInstance(instance, 'drain')">{{ t('page.storage.actions.drain') }}</Button>
                    <Button v-if="instance.state !== 'revoked'" danger :disabled="locked" @click="prepareInstance(instance, 'revoke')">{{ t('page.storage.actions.revoke') }}</Button>
                  </Space>
                  <Form layout="vertical" class="mt-3" @submit.prevent="prepareInstance(instance, 'quota', quota(instance))">
                    <FormItem :label="t('page.storage.quotaInput')" :extra="t('page.storage.quotaHint')" :validate-status="quota(instance) === undefined ? 'error' : undefined" class="mb-2" html-for="storageview-field-1">
                      <Input id="storageview-field-1" v-model:value="limits[instance.id]" inputmode="numeric" :placeholder="String(instance.limit_bytes)" :disabled="locked" />
                    </FormItem>
                    <Button html-type="submit" :disabled="locked || quota(instance) === undefined">{{ t('page.storage.actions.quota') }}</Button>
                  </Form>
                </article>
              </div>
            </TabPane>
            <TabPane key="objects" :tab="t('page.storage.objects')">
              <Table :columns="objectColumns" :data-source="[...data.objects]" :pagination="false" row-key="id" size="middle" :scroll="{ x: 640 }" :locale="{ emptyText: t('page.common.empty') }">
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'id'"><bdi class="break-all font-mono text-xs">{{ record.id }}</bdi></template>
                  <template v-else-if="column.key === 'state'"><Tag>{{ label(`page.storage.states.${record.state}`) }}</Tag></template>
                  <template v-else-if="column.key === 'replicas'">{{ t('page.storage.replicas', { healthy: format.number(record.healthy), desired: format.number(record.desired), missing: format.number(record.missing) }) }}</template>
                  <template v-else-if="column.key === 'reason'">{{ record.reason && te(`page.storage.reasons.${record.reason}`) ? t(`page.storage.reasons.${record.reason}`) : '' }}</template>
                </template>
              </Table>
              <Button class="mt-4" :disabled="locked || !data.next_cursor" @click="nextObjects">{{ t('page.common.next') }}</Button>
            </TabPane>
            <TabPane key="failures" :tab="t('page.storage.failures')">
              <Table :columns="failureColumns" :data-source="[...data.failures]" :pagination="false" row-key="id" size="middle" :scroll="{ x: 720 }" :locale="{ emptyText: t('page.common.empty') }">
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'id'"><bdi class="break-all font-mono text-xs">{{ record.id }}</bdi><div class="text-muted-foreground break-all font-mono text-xs">{{ record.object_id }}</div></template>
                  <template v-else-if="column.key === 'state'"><Tag :color="record.state === 'blocked' ? 'red' : 'default'">{{ label(`page.storage.states.${record.state}`) }}</Tag></template>
                  <template v-else-if="column.key === 'attempts'">{{ format.number(record.attempts) }}</template>
                  <template v-else-if="column.key === 'error'"><span class="font-mono text-xs">{{ record.error_code }}</span></template>
                  <template v-else-if="column.key === 'next'">{{ record.state === 'blocked' ? '' : format.dateTime(record.next_attempt) }}</template>
                  <template v-else-if="column.key === 'action'"><Button size="small" :disabled="locked || record.state !== 'blocked'" @click="prepareJob(record as JobFailure)">{{ t('page.storage.actions.retry') }}</Button></template>
                </template>
              </Table>
              <Button class="mt-4" :disabled="locked || !data.failures_next_cursor" @click="nextFailures">{{ t('page.common.next') }}</Button>
            </TabPane>
          </Tabs>
        </Card>
      </template>
    </div>
    <Modal :open="pending !== null" :title="confirmation" :closable="!sending && !uncertain" :mask-closable="false" :keyboard="!sending && !uncertain" :confirm-loading="sending" :ok-text="t(uncertain ? 'page.common.retryOriginal' : 'page.common.confirm')" :cancel-text="t('page.common.cancel')" :cancel-button-props="{ disabled: sending || uncertain }" @ok="submit" @cancel="cancel">
      <p class="break-all font-mono text-xs"><bdi>{{ pending?.id }}</bdi></p>
      <p>{{ t('page.storage.confirmHint') }}</p>
      <p v-if="pending?.kind === 'instance' && pending.body.action === 'quota'">{{ t('page.storage.newQuota', { value: format.bytes(pending.body.limit_bytes ?? 0) }) }}</p>
      <p v-if="pending?.kind === 'instance' && pending.body.action === 'revoke'">{{ t('page.storage.revokeHint') }}</p>
      <Alert v-if="error" class="mt-2" type="error" show-icon :message="errorText(error)" />
      <Alert v-if="uncertain" class="mt-2" type="warning" show-icon :message="t('page.common.uncertain')" />
    </Modal>
  </AdminPage>
</template>
