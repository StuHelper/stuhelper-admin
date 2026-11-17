<script setup lang="ts">
import type { components } from '#/api/session.gen';

import { computed, onMounted, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Checkbox, Form, FormItem, Input } from 'ant-design-vue';

import { schemaOf } from '#/shared/api/schema';
import { useAsync, useTask } from '#/shared/composables/async';
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
const message = ref('');

function clearDeniedState() {
  version.value = 0;
  subject.value = '';
  confirmed.value = false;
  message.value = '';
}

// Confirmation belongs to the exact account the administrator checked.
watch(subject, () => { confirmed.value = false; }, { flush: 'sync' });

const policyLoad = useAsync(
  (signal) => http.json('/api/v1/admin/session-policy', parsePolicy, { signal }),
  { onDenied: clearDeniedState },
);
const saving = useTask({ onDenied: clearDeniedState });
const revoking = useTask({ onDenied: clearDeniedState });

const busy = computed(() => policyLoad.status.value === 'loading' || saving.busy.value || revoking.busy.value);
const activeError = computed(() => saving.error.value || revoking.error.value || policyLoad.error.value);

async function load() {
  if (busy.value) return;
  message.value = '';
  await policyLoad.reload();
  const policy = policyLoad.data.value;
  if (policy) {
    interval.value = policy.interval_minutes;
    grace.value = policy.grace_minutes;
    version.value = policy.version;
  }
}

async function save() {
  if (busy.value || !version.value) return;
  message.value = '';
  const body: components['schemas']['SessionPolicyUpdate'] = {
    interval_minutes: Number(interval.value),
    grace_minutes: Number(grace.value),
    expected_version: version.value,
  };
  const policy = await saving.run(() =>
    http.json('/api/v1/admin/session-policy', parsePolicy, { method: 'PUT', body }),
  );
  if (policy) {
    version.value = policy.version;
    message.value = 'saved';
  }
}

async function revoke() {
  if (busy.value || !confirmed.value || !subject.value.trim()) return;
  message.value = '';
  const body: components['schemas']['ForceLogout'] = { subject: subject.value.trim() };
  const ok = await revoking.run(async () => {
    await http.send('/api/v1/admin/sessions/revoke', { method: 'POST', body });
    return true;
  });
  if (ok) {
    message.value = 'revoked';
    confirmed.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AdminPage :title="t('page.sessionPolicy.title')" :description="t('page.sessionPolicy.description')">
    <div class="flex max-w-2xl flex-col gap-4" :aria-busy="busy">
      <p v-if="busy" role="status">{{ t('page.sessionPolicy.loading') }}</p>
      <Alert
        v-if="activeError"
        type="error"
        show-icon
        role="alert"
        :message="activeError === 'session_policy_conflict' ? t('page.sessionPolicy.conflict') : errorText(activeError)"
      >
        <template #action>
          <Button size="small" :disabled="busy" @click="load">{{ t('page.sessionPolicy.reload') }}</Button>
        </template>
      </Alert>
      <Alert v-if="message && !busy" type="success" role="status" :message="t(`page.sessionPolicy.${message}`)" />
      <Card :bordered="false">
        <Form layout="vertical" @submit.prevent="save">
          <FormItem :label="t('page.sessionPolicy.interval')" required html-for="session-review">
            <Input
              id="session-review"
              :value="String(interval)"
              type="number"
              min="5"
              max="240"
              step="1"
              required
              :disabled="busy || !version"
              @update:value="(val) => { interval = Number(val); }"
            />
          </FormItem>
          <FormItem :label="t('page.sessionPolicy.grace')" required html-for="session-grace">
            <Input
              id="session-grace"
              :value="String(grace)"
              type="number"
              min="0"
              max="240"
              step="1"
              required
              :disabled="busy || !version"
              @update:value="(val) => { grace = Number(val); }"
            />
          </FormItem>
          <Button type="primary" html-type="submit" :loading="saving.busy.value" :disabled="busy || !version">
            {{ t('page.sessionPolicy.save') }}
          </Button>
        </Form>
      </Card>
      <Card :bordered="false" :title="t('page.sessionPolicy.forceTitle')">
        <Form layout="vertical" @submit.prevent="revoke">
          <FormItem :label="t('page.sessionPolicy.subject')" required html-for="session-subject">
            <Input
              id="session-subject"
              v-model:value="subject"
              :maxlength="256"
              required
              :disabled="busy || !version"
              autocomplete="off"
              dir="ltr"
            />
          </FormItem>
          <FormItem>
            <Checkbox v-model:checked="confirmed" :disabled="busy || !version">
              {{ t('page.sessionPolicy.confirm') }}
            </Checkbox>
          </FormItem>
          <Button danger html-type="submit" :loading="revoking.busy.value" :disabled="busy || !version || !confirmed || !subject.trim()">
            {{ t('page.sessionPolicy.force') }}
          </Button>
        </Form>
      </Card>
    </div>
  </AdminPage>
</template>
