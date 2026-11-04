<script setup lang="ts">
import type { InstanceHealth } from '../api/storage';

import { computed, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { createFormatters, useI18n } from '@vben/locales';
import { preferences } from '@vben/preferences';

import { Alert, Button, Card, Modal } from 'ant-design-vue';

import { stateTone } from '#/console-ui';

import { useStorage } from '../composables/useStorage';

const { t, te, locale } = useI18n();
const { data, loading, sending, error, pending, uncertain, completed, reload, prepareInstance, prepareJob, cancel, submit, nextObjects, nextFailures, firstPage } = useStorage();
const limits = ref<Record<string, string>>({});
const format = computed(() => createFormatters(locale.value, preferences.app.timezone));
const bytes = (value: number) => t('page.storage.bytes', { value: format.value.number(value) });
const state = (value: string) => te(`page.storage.states.${value}`) ? t(`page.storage.states.${value}`) : t('page.storage.unknown');
const reason = (value: string) => value && te(`page.storage.reasons.${value}`) ? t(`page.storage.reasons.${value}`) : '';
const errorMessage = computed(() => error.value ? t(`page.storage.errors.${error.value}`) : '');
const locked = computed(() => loading.value || sending.value || pending.value !== null);
const confirmation = computed(() => pending.value ? t('page.storage.confirm', { action: t(`page.storage.actions.${pending.value.kind === 'job' ? 'retry' : pending.value.body.action}`), id: pending.value.id }) : '');
function quota(instance: InstanceHealth) {
  const raw = limits.value[instance.id] ?? String(instance.limit_bytes);
  const limit = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(limit) && limit >= instance.used_bytes + instance.reserved_bytes ? limit : undefined;
}
</script>

<template>
  <Page :title="t('page.storage.title')" :description="t('page.storage.description')">
    <div class="storage-page">
      <nav class="console-controls" :aria-label="t('page.storage.navigation')">
        <Button :disabled="locked" :loading="loading" @click="reload()">{{ t('page.storage.refresh') }}</Button>
        <Button :disabled="locked" @click="firstPage">{{ t('page.storage.first') }}</Button>
        <span v-if="data" class="console-end">{{ t('page.storage.updated', { time: format.dateTime(data.generated_at) }) }}</span>
      </nav>
      <div role="status" aria-live="polite">
        <Alert v-if="loading" :message="t('page.storage.loading')" type="info" show-icon />
        <Alert v-else-if="error" :message="errorMessage" type="error" show-icon />
        <Alert v-else-if="completed" :message="t('page.storage.completed')" type="success" show-icon />
      </div>
      <template v-if="data">
        <Card :title="t('page.storage.queue')">
          <dl class="console-tiles">
            <div v-for="(value, key) in data.jobs" :key="key"><dt>{{ state(key) }}</dt><dd>{{ format.number(value) }}</dd></div>
          </dl>
        </Card>
        <Card :title="t('page.storage.instances')">
          <p v-if="data.instances.length === 0">{{ t('page.storage.empty') }}</p>
          <div class="console-inventory">
            <article v-for="instance in data.instances" :key="instance.id" class="console-entry">
              <div class="console-row-head"><h3><bdi>{{ instance.id }}</bdi></h3><span class="console-badge" :data-tone="stateTone(instance.state)">{{ state(instance.state) }}</span></div>
              <progress class="console-meter" :value="instance.used_bytes + instance.reserved_bytes" :max="instance.limit_bytes || 1" :aria-label="t('page.storage.used')"></progress>
              <p v-if="reason(instance.reason)">{{ reason(instance.reason) }}</p>
              <dl class="console-tiles">
                <div><dt>{{ t('page.storage.limit') }}</dt><dd>{{ bytes(instance.limit_bytes) }}</dd></div>
                <div><dt>{{ t('page.storage.used') }}</dt><dd>{{ bytes(instance.used_bytes) }}</dd></div>
                <div><dt>{{ t('page.storage.reserved') }}</dt><dd>{{ bytes(instance.reserved_bytes) }}</dd></div>
                <div><dt>{{ t('page.storage.available') }}</dt><dd>{{ bytes(instance.available_bytes) }}</dd></div>
              </dl>
              <p>{{ t('page.storage.authorizationExpiry', { time: format.dateTime(instance.authorization_expires_at) }) }}</p>
              <div class="console-controls" :aria-label="instance.id">
                <Button v-if="instance.state === 'active'" :disabled="locked" @click="prepareInstance(instance, 'pause')">{{ t('page.storage.actions.pause') }}</Button>
                <Button v-if="instance.state === 'paused'" :disabled="locked" @click="prepareInstance(instance, 'resume')">{{ t('page.storage.actions.resume') }}</Button>
                <Button v-if="['active', 'paused'].includes(instance.state)" :disabled="locked" @click="prepareInstance(instance, 'drain')">{{ t('page.storage.actions.drain') }}</Button>
                <Button v-if="instance.state !== 'revoked'" danger :disabled="locked" @click="prepareInstance(instance, 'revoke')">{{ t('page.storage.actions.revoke') }}</Button>
              </div>
              <form class="quota-form" @submit.prevent="prepareInstance(instance, 'quota', quota(instance))">
                <label :for="`quota-${instance.id}`">{{ t('page.storage.quotaInput') }}</label>
                <input :id="`quota-${instance.id}`" v-model="limits[instance.id]" inputmode="numeric" :placeholder="String(instance.limit_bytes)" :disabled="locked" :aria-invalid="quota(instance) === undefined" :aria-describedby="`quota-error-${instance.id}`" />
                <span :id="`quota-error-${instance.id}`">{{ t('page.storage.quotaHint') }}</span>
                <Button html-type="submit" :disabled="locked || quota(instance) === undefined">{{ t('page.storage.actions.quota') }}</Button>
              </form>
            </article>
          </div>
        </Card>
        <Card :title="t('page.storage.objects')">
          <p v-if="data.objects.length === 0">{{ t('page.storage.empty') }}</p>
          <div class="console-inventory">
            <article v-for="object in data.objects" :key="object.id" class="console-entry">
              <div class="console-row-head"><h3><bdi>{{ object.id }}</bdi></h3><span class="console-badge" :data-tone="stateTone(object.state)">{{ state(object.state) }}</span></div>
              <p>{{ t('page.storage.replicas', { healthy: format.number(object.healthy), desired: format.number(object.desired), missing: format.number(object.missing) }) }}</p>
              <p v-if="reason(object.reason)">{{ reason(object.reason) }}</p>
            </article>
          </div>
          <Button class="mt-4" :disabled="locked || !data.next_cursor" @click="nextObjects">{{ t('page.storage.nextObjects') }}</Button>
        </Card>
        <Card :title="t('page.storage.failures')">
          <p v-if="data.failures.length === 0">{{ t('page.storage.empty') }}</p>
          <div class="console-inventory">
            <article v-for="job in data.failures" :key="job.id" class="console-entry">
              <div class="console-row-head"><h3><bdi>{{ job.id }}</bdi></h3><span class="console-badge" :data-tone="stateTone(job.state)">{{ state(job.state) }}</span></div>
              <p>{{ t('page.storage.objectId', { id: job.object_id }) }}</p>
              <p>{{ t('page.storage.attempts', { count: format.number(job.attempts) }) }}</p>
              <p>{{ t('page.storage.errorCode', { code: job.error_code }) }}</p>
              <p v-if="job.state !== 'blocked'">{{ t('page.storage.nextAttempt', { time: format.dateTime(job.next_attempt) }) }}</p>
              <Button :disabled="locked || job.state !== 'blocked'" @click="prepareJob(job)">{{ t('page.storage.actions.retry') }}</Button>
            </article>
          </div>
          <Button class="mt-4" :disabled="locked || !data.failures_next_cursor" @click="nextFailures">{{ t('page.storage.nextFailures') }}</Button>
        </Card>
      </template>
      <Modal :open="pending !== null" :title="confirmation" :closable="!sending && !uncertain" :mask-closable="false" :keyboard="!sending && !uncertain" :confirm-loading="sending" :ok-text="t(uncertain ? 'page.storage.retryOriginal' : 'page.storage.confirmButton')" :cancel-text="t('page.storage.cancel')" :cancel-button-props="{ disabled: sending || uncertain }" @ok="submit" @cancel="cancel">
        <p>{{ t('page.storage.confirmHint') }}</p>
        <p v-if="pending?.kind === 'instance' && pending.body.action === 'quota'">{{ bytes(pending.body.limit_bytes ?? 0) }}</p>
        <p v-if="pending?.kind === 'instance' && pending.body.action === 'revoke'">{{ t('page.storage.revokeHint') }}</p>
        <Alert v-if="uncertain" :message="t('page.storage.uncertain')" type="warning" show-icon />
      </Modal>
    </div>
  </Page>
</template>

<style scoped>
.quota-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .35rem .5rem; align-items: center; margin-block-start: 1rem; }
.quota-form label, .quota-form span { grid-column: 1 / -1; font-size: .8rem; color: hsl(var(--muted-foreground)); }
.quota-form input { width: 100%; min-width: 0; min-height: 32px; padding: .25rem .5rem; border: 1px solid hsl(var(--border)); border-radius: 6px; background: transparent; }
.quota-form input:focus-visible { outline: 2px solid hsl(var(--primary)); outline-offset: 2px; }
</style>
