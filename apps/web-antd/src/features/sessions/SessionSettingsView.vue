<script setup lang="ts">
import type { components } from '#/api/session.gen';

import {
  computed,
  getCurrentInstance,
  inject,
  onMounted,
  ref,
  watch,
} from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Checkbox, Form, FormItem, Input } from 'ant-design-vue';

import { ApiError, isDeniedCode } from '#/shared/api/errors';
import { schemaOf } from '#/shared/api/schema';
import { useAsync, useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { sessionKey, useHttp } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';

import contract from '../../../../../contracts/session.openapi.json';

const { t } = useI18n();
const http = useHttp();
const errorText = useErrorText();
const session = getCurrentInstance()
  ? inject(sessionKey, undefined)
  : undefined;
const write = useMutation();

const parsePolicy = schemaOf<components['schemas']['SessionPolicy']>(
  contract.components.schemas,
  'SessionPolicy',
);
const parseResult = schemaOf<components['schemas']['SessionMutationResult']>(
  contract.components.schemas,
  'SessionMutationResult',
);

const interval = ref(30);
const grace = ref(30);
const version = ref(0);
const subject = ref('');
const confirmed = ref(false);
// Confirmation belongs to the exact account the administrator checked.
watch(
  subject,
  () => {
    if (!write.uncertain.value) confirmed.value = false;
  },
  { flush: 'sync' },
);

const policyLoad = useAsync(
  (signal) => http.json('/api/v1/admin/session-policy', parsePolicy, { signal }),
  { onDenied: clearSensitive },
);
const message = ref('');
let pendingKind: 'revoke' | 'save' | undefined;

const busy = computed(() => policyLoad.status.value === 'loading' || write.busy.value);
const locked = computed(() => busy.value || write.uncertain.value);
const activeError = computed(() => write.error.value || policyLoad.error.value);

useLeaveGuard(() => {
  if (write.uncertain.value) return t('page.common.leaveUncertain');
  return busy.value ? t('page.common.leaveUnsaved') : '';
});

function clearSensitive() {
  version.value = 0;
  subject.value = '';
  message.value = '';
  confirmed.value = false;
}

watch(
  () => session?.state.value,
  (state) => {
    if (state === 'guest') clearSensitive();
  },
);

async function load() {
  if (locked.value) return;
  write.dismiss();
  message.value = '';
  await policyLoad.reload();
  const policy = policyLoad.data.value;
  if (policy) {
    interval.value = policy.interval_minutes;
    grace.value = policy.grace_minutes;
    version.value = policy.version;
  }
}

function applyOutcome(kind: 'revoke' | 'save', result: unknown) {
  if (kind === 'save') {
    const policy = result as components['schemas']['SessionPolicy'];
    version.value = policy.version;
    message.value = 'saved';
    return;
  }
  message.value = 'revoked';
  confirmed.value = false;
}

async function save() {
  if (locked.value || !version.value) return;
  policyLoad.clear();
  message.value = '';
  pendingKind = 'save';
  const body: components['schemas']['SessionPolicyUpdate'] = {
    interval_minutes: interval.value,
    grace_minutes: grace.value,
    expected_version: version.value,
  };
  const policy = await write.run('session-policy', body, (frozen, key) =>
    http.json('/api/v1/admin/session-policy', parsePolicy, {
      method: 'PUT',
      body: frozen,
      key,
    }),
  );
  if (policy) {
    pendingKind = undefined;
    applyOutcome('save', policy);
  } else if (!write.uncertain.value) {
    pendingKind = undefined;
    if (isDeniedCode(write.error.value)) clearSensitive();
  }
}

async function revoke() {
  if (locked.value || !confirmed.value || !subject.value.trim()) return;
  policyLoad.clear();
  message.value = '';
  pendingKind = 'revoke';
  const body: components['schemas']['ForceLogout'] = {
    subject: subject.value.trim(),
  };
  const outcome = await write.run(
    `session-revoke:${body.subject}`,
    body,
    async (frozen, key) => {
      const res = await http.json(
        '/api/v1/admin/sessions/revoke',
        parseResult,
        { method: 'POST', body: frozen, key },
      );
      if (!res.success) throw new ApiError('unavailable');
      return res;
    },
  );
  if (outcome) {
    pendingKind = undefined;
    applyOutcome('revoke', outcome);
  } else if (!write.uncertain.value) {
    pendingKind = undefined;
    if (isDeniedCode(write.error.value)) clearSensitive();
  }
}

async function retryWrite() {
  const kind = pendingKind;
  const outcome = await write.retry();
  if (outcome && kind) {
    pendingKind = undefined;
    applyOutcome(kind, outcome);
  } else if (!write.uncertain.value) {
    pendingKind = undefined;
    if (isDeniedCode(write.error.value)) clearSensitive();
  }
}

onMounted(load);
</script>

<template>
  <AdminPage :title="t('page.sessionPolicy.title')" :description="t('page.sessionPolicy.description')">
    <div class="flex max-w-2xl flex-col gap-4" :aria-busy="busy">
      <p v-if="busy" role="status">{{ t('page.sessionPolicy.loading') }}</p>
      <Alert
        v-if="write.uncertain.value" type="warning" show-icon role="alert" :message="t('page.common.uncertain')"
      >
        <template #action>
          <Button size="small" :disabled="busy" @click="retryWrite">{{ t('page.common.retryOriginal') }}</Button>
        </template>
      </Alert>
      <Alert
        v-else-if="activeError"
        type="error"
        show-icon
        role="alert"
        :message="activeError === 'session_policy_conflict' ? t('page.sessionPolicy.conflict') : errorText(activeError)"
      >
        <template #action>
          <Button size="small" :disabled="locked" @click="load">{{ t('page.sessionPolicy.reload') }}</Button>
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
              :disabled="locked || !version"
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
              :disabled="locked || !version"
              @update:value="(val) => { grace = Number(val); }"
            />
          </FormItem>
          <Button type="primary" html-type="submit" :loading="write.busy.value && pendingKind === 'save'" :disabled="locked || !version">
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
              :disabled="locked || !version"
              autocomplete="off"
              dir="ltr"
            />
          </FormItem>
          <FormItem>
            <Checkbox v-model:checked="confirmed" :disabled="locked || !version">
              {{ t('page.sessionPolicy.confirm') }}
            </Checkbox>
          </FormItem>
          <Button danger html-type="submit" :loading="write.busy.value && pendingKind === 'revoke'" :disabled="locked || !version || !confirmed || !subject.trim()">
            {{ t('page.sessionPolicy.force') }}
          </Button>
        </Form>
      </Card>
    </div>
  </AdminPage>
</template>
