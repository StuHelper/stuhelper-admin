<script setup lang="ts">
import type { Contribution } from '#/api/contribution';

import { computed } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Descriptions, DescriptionsItem, Modal, Space, Tag } from 'ant-design-vue';

import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';

import { useContributions } from './useContributions';

// Contributions of all users within scope, without credentials. Administrators
// can only retry a blocked original request; they cannot change a user's
// consent, term, quota or revocation.
const { t, te } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const { data, loading, sending, error, pending, uncertain, completed, reload, prepare, cancel, submit, next, first } = useContributions(true);
const label = (key: string) => (te(key) ? t(key) : t('page.contribution.unknown'));
const desired: Record<Contribution['desired_state'], string> = { active: 'resume', paused: 'pause', exiting: 'exit', revoked: 'revoke' };
const locked = computed(() => loading.value || sending.value || !!pending.value);
function retry(item: Contribution) {
  prepare({ kind: 'retry', id: item.id, key: crypto.randomUUID(), body: { revision: item.revision } });
}
</script>

<template>
  <AdminPage :title="t('page.contribution.title')" :description="t('page.contribution.intro')">
    <template #extra>
      <Space>
        <Button :disabled="locked" :loading="loading" @click="reload()">{{ t('page.common.refresh') }}</Button>
        <Button :disabled="locked" @click="first">{{ t('page.common.firstPage') }}</Button>
      </Space>
    </template>
    <div class="flex flex-col gap-4">
      <div aria-live="polite">
        <Alert v-if="error && !pending" type="error" show-icon role="alert" :message="errorText(error)" />
        <Alert v-else-if="completed" type="success" show-icon role="status" :message="t('page.contribution.accepted')" />
      </div>
      <Card v-if="loading && !data" :bordered="false" :loading="true" />
      <template v-if="data">
        <Alert type="info" show-icon :message="t('page.contribution.adminHint')" />
        <Card v-if="data.items.length === 0" :bordered="false"><p class="text-muted-foreground">{{ t('page.common.empty') }}</p></Card>
        <div class="grid gap-4 xl:grid-cols-2">
          <Card v-for="item in data.items" :key="item.id" :bordered="false">
            <template #title><bdi>{{ item.adapter }}</bdi></template>
            <template #extra><Tag :color="item.state === 'active' ? 'green' : item.state === 'blocked' ? 'red' : 'orange'">{{ label(`page.contribution.states.${item.state}`) }}</Tag></template>
            <article>
              <p class="text-muted-foreground mb-3 break-all font-mono text-xs"><bdi>{{ item.id }}</bdi></p>
              <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
                <DescriptionsItem :label="t('page.contribution.requested')">{{ t(`page.contribution.actions.${desired[item.desired_state]}`) }}</DescriptionsItem>
                <DescriptionsItem :label="t('page.contribution.untilLabel')">{{ format.dateTime(item.conditions.until) }}</DescriptionsItem>
                <DescriptionsItem :label="t('page.contribution.quota')">{{ format.bytes(item.conditions.limit_bytes) }}</DescriptionsItem>
                <DescriptionsItem :label="t('page.contribution.personal')">{{ format.bytes(item.conditions.personal_reserve) }}</DescriptionsItem>
                <template v-if="item.observation">
                  <DescriptionsItem :label="t('page.contribution.used')">{{ format.bytes(item.observation.used_bytes) }}</DescriptionsItem>
                  <DescriptionsItem :label="t('page.contribution.available')">{{ format.bytes(item.observation.available_bytes) }}</DescriptionsItem>
                  <DescriptionsItem :label="t('page.contribution.remainingLabel')">{{ format.number(item.observation.remaining_replicas) }}</DescriptionsItem>
                  <DescriptionsItem :label="t('page.contribution.observedLabel')">{{ format.dateTime(item.observation.observed_at) }}</DescriptionsItem>
                </template>
                <DescriptionsItem v-if="item.exit_target_at" :label="t('page.contribution.exitTargetLabel')">{{ format.dateTime(item.exit_target_at) }}</DescriptionsItem>
              </Descriptions>
              <Alert v-if="item.reason" class="mt-3" type="warning" show-icon :message="label(`page.contribution.reasons.${item.reason}`)" />
              <Button v-if="item.state === 'blocked'" class="mt-3" :disabled="locked" @click="retry(item)">{{ t('page.contribution.actions.retry') }}</Button>
            </article>
          </Card>
        </div>
        <Button v-if="data.next_cursor" class="self-center" :disabled="locked" @click="next">{{ t('page.common.next') }}</Button>
      </template>
    </div>
    <Modal :open="!!pending" :title="t('page.contribution.confirmRetry')" :closable="!sending && !uncertain" :keyboard="!sending && !uncertain" :mask-closable="false" @cancel="cancel">
      <template v-if="pending">
        <p class="break-all font-mono text-xs"><bdi>{{ pending.kind === 'create' ? '' : pending.id }}</bdi></p>
        <p>{{ t('page.contribution.adminHint') }}</p>
        <Alert v-if="error" class="mt-2" type="error" show-icon :message="errorText(error)" />
        <Alert v-if="uncertain" class="mt-2" type="warning" show-icon :message="t('page.common.uncertain')" />
      </template>
      <template #footer>
        <Button :disabled="sending || uncertain" @click="cancel">{{ t('page.common.cancel') }}</Button>
        <Button type="primary" :loading="sending" @click="submit">{{ t(uncertain ? 'page.common.retryOriginal' : 'page.common.confirm') }}</Button>
      </template>
    </Modal>
  </AdminPage>
</template>
