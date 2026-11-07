<script setup lang="ts">
import type { Contribution } from '../api/contribution';

import { computed } from 'vue';

import { Page } from '@vben/common-ui';
import { createFormatters, useI18n } from '@vben/locales';
import { preferences } from '@vben/preferences';

import { Alert, Button, Card, ConfigProvider, Modal, Tag } from 'ant-design-vue';

import { tagColor } from '#/console-ui';

import { useContributions } from '../composables/useContributions';

const { t, te, locale } = useI18n();
const { data, loading, sending, error, pending, uncertain, completed, reload, prepare, cancel, submit, next, first } = useContributions(true);
const format = computed(() => createFormatters(locale.value, preferences.app.timezone));
const bytes = (value: number) => t('page.contribution.bytes', { value: format.value.number(value) });
const state = (value: string) => te(`page.contribution.states.${value}`) ? t(`page.contribution.states.${value}`) : t('page.contribution.unknown');
const target = (value: Contribution['desired_state']) => t(`page.contribution.actions.${({ active: 'resume', paused: 'pause', exiting: 'exit', revoked: 'revoke' })[value]}`);
const reason = (value: string) => te(`page.contribution.reasons.${value}`) ? t(`page.contribution.reasons.${value}`) : t('page.contribution.unknown');
const locked = computed(() => loading.value || sending.value || !!pending.value);
function retry(item: Contribution) { prepare({ kind: 'retry', id: item.id, key: crypto.randomUUID(), body: { revision: item.revision } }); }
</script>

<template>
  <ConfigProvider :auto-insert-space-in-button="false">
  <Page :title="t('page.contribution.adminTitle')" :description="t('page.contribution.adminDescription')">
    <div class="contribution-page">
      <nav class="console-controls" :aria-label="t('page.storage.navigation')">
        <Button :disabled="locked" :loading="loading" @click="reload()">{{ t('page.contribution.refresh') }}</Button>
        <Button :disabled="locked" @click="first">{{ t('page.contribution.first') }}</Button>
      </nav>
      <div role="status" aria-live="polite">
        <Alert v-if="loading" :message="t('page.contribution.loading')" type="info" show-icon />
        <Alert v-else-if="error" :message="t(`page.contribution.errors.${error}`)" type="error" show-icon />
        <Alert v-else-if="completed" :message="t('page.contribution.accepted')" type="success" show-icon />
      </div>
      <template v-if="data">
        <p>{{ t('page.contribution.adminHint') }}</p>
        <Card v-if="data.items.length === 0"><p>{{ t('page.contribution.empty') }}</p></Card>
        <div class="console-inventory">
          <article v-for="item in data.items" :key="item.id" class="console-entry">
            <div class="console-row-head"><h2><bdi>{{ item.adapter }}</bdi></h2><Tag :color="tagColor(item.state)">{{ state(item.state) }}</Tag></div><p class="console-identifier"><bdi>{{ item.id }}</bdi></p>
            <dl class="console-tiles"><div><dt>{{ t('page.contribution.requested') }}</dt><dd>{{ target(item.desired_state) }}</dd></div><div><dt>{{ t('page.contribution.actual') }}</dt><dd>{{ state(item.state) }}</dd></div><div><dt>{{ t('page.contribution.quota') }}</dt><dd>{{ bytes(item.conditions.limit_bytes) }}</dd></div><div><dt>{{ t('page.contribution.personal') }}</dt><dd>{{ bytes(item.conditions.personal_reserve) }}</dd></div></dl>
            <p v-if="item.reason">{{ reason(item.reason) }}</p>
            <p>{{ t('page.contribution.until', { time: format.dateTime(item.conditions.until) }) }}</p>
            <template v-if="item.observation">
              <dl class="console-tiles"><div><dt>{{ t('page.contribution.used') }}</dt><dd>{{ bytes(item.observation.used_bytes) }}</dd></div><div><dt>{{ t('page.contribution.reserved') }}</dt><dd>{{ bytes(item.observation.reserved_bytes) }}</dd></div><div><dt>{{ t('page.contribution.available') }}</dt><dd>{{ bytes(item.observation.available_bytes) }}</dd></div></dl>
              <p>{{ t('page.contribution.remaining', { count: format.number(item.observation.remaining_replicas) }) }}</p><p>{{ t('page.contribution.observed', { time: format.dateTime(item.observation.observed_at) }) }}</p>
            </template>
            <p v-if="item.exit_target_at">{{ t('page.contribution.exitTarget', { time: format.dateTime(item.exit_target_at) }) }}</p>
            <Button v-if="item.state === 'blocked'" :disabled="locked" @click="retry(item)">{{ t('page.contribution.actions.retry') }}</Button>
          </article>
        </div>
        <Button :disabled="locked || !data.next_cursor" @click="next">{{ t('page.contribution.next') }}</Button>
      </template>
      <Modal :open="!!pending" :title="t('page.contribution.confirm', { action: t('page.contribution.actions.retry') })" :closable="!sending && !uncertain" :keyboard="!sending && !uncertain" :mask-closable="false" @cancel="cancel">
        <template v-if="pending && pending.kind === 'retry'"><p class="console-identifier"><bdi>{{ pending.id }}</bdi></p><p>{{ t('page.contribution.adminHint') }}</p><p>{{ t('page.contribution.confirmHint') }}</p><Alert v-if="error" :message="t(`page.contribution.errors.${error}`)" type="error" /><Alert v-if="uncertain" :message="t('page.contribution.uncertain')" type="warning" /></template>
        <template #footer><Button :disabled="sending || uncertain" @click="cancel">{{ t('page.contribution.cancel') }}</Button><Button type="primary" :loading="sending" @click="submit">{{ t(uncertain ? 'page.contribution.retryOriginal' : 'page.contribution.confirmButton') }}</Button></template>
      </Modal>
    </div>
  </Page>
  </ConfigProvider>
</template>
