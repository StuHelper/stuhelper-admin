<script setup lang="ts">
import type { components } from '#/api/session.gen';

import { onMounted, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { errorCode } from '#/shared/api/errors';
import { schemaOf } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';

import contract from '../../../../../contracts/session.openapi.json';

const { t } = useI18n();
const http = useHttp();
const errorText = useErrorText();
const parsePolicy = schemaOf<components['schemas']['SessionPolicy']>(contract.components.schemas, 'SessionPolicy');
const interval = ref(30);
const grace = ref(30);
const version = ref(0);
const subject = ref('');
const confirmed = ref(false);
// Confirmation belongs to the exact account the administrator checked.
watch(subject, () => { confirmed.value = false; }, { flush: 'sync' });
const busy = ref(false);
const error = ref('');
const message = ref('');
async function load() {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const policy = await http.json('/api/v1/admin/session-policy', parsePolicy);
    interval.value = policy.interval_minutes; grace.value = policy.grace_minutes; version.value = policy.version;
  } catch (error_) { error.value = errorCode(error_); }
  finally { busy.value = false; }
}
async function save() {
  if (busy.value || !version.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const body: components['schemas']['SessionPolicyUpdate'] = { interval_minutes: interval.value, grace_minutes: grace.value, expected_version: version.value };
    const policy = await http.json('/api/v1/admin/session-policy', parsePolicy, { method: 'PUT', body });
    version.value = policy.version; message.value = 'saved';
  } catch (error_) { error.value = errorCode(error_); }
  finally { busy.value = false; }
}
async function revoke() {
  if (busy.value || !confirmed.value || !subject.value.trim()) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const body: components['schemas']['ForceLogout'] = { subject: subject.value.trim() };
    await http.send('/api/v1/admin/sessions/revoke', { method: 'POST', body });
    message.value = 'revoked'; confirmed.value = false;
  } catch (error_) { error.value = errorCode(error_); }
  finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <AdminPage :title="t('page.sessionPolicy.title')" :description="t('page.sessionPolicy.description')">
    <div class="flex max-w-2xl flex-col gap-5" :aria-busy="busy">
      <p v-if="busy" role="status">{{ t('page.sessionPolicy.loading') }}</p>
      <div v-if="error" role="alert" class="text-destructive">
        {{ error === 'session_policy_conflict' ? t('page.sessionPolicy.conflict') : errorText(error) }}
        <button type="button" class="ms-3 underline" :disabled="busy" @click="load">{{ t('page.sessionPolicy.reload') }}</button>
      </div>
      <p v-if="message" role="status">{{ t(`page.sessionPolicy.${message}`) }}</p>
      <form class="bg-card flex flex-col gap-4 rounded-lg border p-5" @submit.prevent="save">
        <label for="session-review" class="flex flex-col gap-2">
          {{ t('page.sessionPolicy.interval') }}
          <input id="session-review" v-model.number="interval" class="bg-background rounded border p-2" type="number" min="5" max="240" step="1" required :disabled="busy || !version" />
        </label>
        <label for="session-grace" class="flex flex-col gap-2">
          {{ t('page.sessionPolicy.grace') }}
          <input id="session-grace" v-model.number="grace" class="bg-background rounded border p-2" type="number" min="0" max="240" step="1" required :disabled="busy || !version" />
        </label>
        <button type="submit" class="bg-primary text-primary-foreground rounded px-4 py-2 disabled:opacity-50" :disabled="busy || !version">{{ t('page.sessionPolicy.save') }}</button>
      </form>
      <form class="bg-card flex flex-col gap-4 rounded-lg border p-5" @submit.prevent="revoke">
        <h2 class="text-lg font-semibold">{{ t('page.sessionPolicy.forceTitle') }}</h2>
        <label for="session-subject" class="flex flex-col gap-2">
          {{ t('page.sessionPolicy.subject') }}
          <input id="session-subject" v-model="subject" class="bg-background min-w-0 rounded border p-2" type="text" maxlength="256" required :disabled="busy || !version" autocomplete="off" dir="ltr" />
        </label>
        <label class="flex items-start gap-2">
          <input v-model="confirmed" type="checkbox" required :disabled="busy || !version" />
          {{ t('page.sessionPolicy.confirm') }}
        </label>
        <button type="submit" class="rounded border px-4 py-2 disabled:opacity-50" :disabled="busy || !version || !confirmed">{{ t('page.sessionPolicy.force') }}</button>
      </form>
    </div>
  </AdminPage>
</template>
