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

import { ApiError, errorCode, isDeniedCode } from '#/shared/api/errors';
import { schemaOf } from '#/shared/api/schema';
import { useMutation } from '#/shared/composables/async';
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

const loading = ref(false);
const loadError = ref('');
const message = ref('');
let pendingKind: 'revoke' | 'save' | undefined;

const busy = computed(() => loading.value || write.busy.value);
const locked = computed(() => busy.value || write.uncertain.value);
const activeError = computed(() => write.error.value || loadError.value);

useLeaveGuard(() => {
  if (write.uncertain.value) return t('page.common.leaveUncertain');
  return busy.value ? t('page.common.leaveUnsaved') : '';
});

function clearSensitive() {
  version.value = 0;
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
  loading.value = true;
  loadError.value = '';
  write.dismiss();
  message.value = '';
  try {
    const policy = await http.json('/api/v1/admin/session-policy', parsePolicy);
    interval.value = policy.interval_minutes;
    grace.value = policy.grace_minutes;
    version.value = policy.version;
  } catch (error_) {
    loadError.value = errorCode(error_);
    if (error_ instanceof ApiError && error_.denied) clearSensitive();
  } finally {
    loading.value = false;
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
  loadError.value = '';
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
  loadError.value = '';
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
  <AdminPage
    :title="t('page.sessionPolicy.title')"
    :description="t('page.sessionPolicy.description')"
  >
    <div class="flex max-w-2xl flex-col gap-5" :aria-busy="busy">
      <p v-if="busy" role="status">{{ t('page.sessionPolicy.loading') }}</p>
      <div v-if="write.uncertain.value" role="alert" class="text-destructive">
        {{ t('page.common.uncertain') }}
        <button
          type="button"
          class="ms-3 underline"
          :disabled="busy"
          @click="retryWrite"
        >
          {{ t('page.common.retryOriginal') }}
        </button>
      </div>
      <div v-else-if="activeError" role="alert" class="text-destructive">
        {{
          activeError === 'session_policy_conflict'
            ? t('page.sessionPolicy.conflict')
            : errorText(activeError)
        }}
        <button
          type="button"
          class="ms-3 underline"
          :disabled="locked"
          @click="load"
        >
          {{ t('page.sessionPolicy.reload') }}
        </button>
      </div>
      <p v-if="message" role="status">
        {{ t(`page.sessionPolicy.${message}`) }}
      </p>
      <form
        class="bg-card flex flex-col gap-4 rounded-lg border p-5"
        @submit.prevent="save"
      >
        <label for="session-review" class="flex flex-col gap-2">
          {{ t('page.sessionPolicy.interval') }}
          <input
            id="session-review"
            v-model.number="interval"
            class="bg-background rounded border p-2"
            type="number"
            min="5"
            max="240"
            step="1"
            required
            :disabled="locked || !version"
          />
        </label>
        <label for="session-grace" class="flex flex-col gap-2">
          {{ t('page.sessionPolicy.grace') }}
          <input
            id="session-grace"
            v-model.number="grace"
            class="bg-background rounded border p-2"
            type="number"
            min="0"
            max="240"
            step="1"
            required
            :disabled="locked || !version"
          />
        </label>
        <button
          type="submit"
          class="bg-primary text-primary-foreground rounded px-4 py-2 disabled:opacity-50"
          :disabled="locked || !version"
        >
          {{ t('page.sessionPolicy.save') }}
        </button>
      </form>
      <form
        class="bg-card flex flex-col gap-4 rounded-lg border p-5"
        @submit.prevent="revoke"
      >
        <h2 class="text-lg font-semibold">
          {{ t('page.sessionPolicy.forceTitle') }}
        </h2>
        <label for="session-subject" class="flex flex-col gap-2">
          {{ t('page.sessionPolicy.subject') }}
          <input
            id="session-subject"
            v-model="subject"
            class="bg-background min-w-0 rounded border p-2"
            type="text"
            maxlength="256"
            required
            :disabled="locked || !version"
            autocomplete="off"
            dir="ltr"
          />
        </label>
        <label class="flex items-start gap-2">
          <input
            v-model="confirmed"
            type="checkbox"
            required
            :disabled="locked || !version"
          />
          {{ t('page.sessionPolicy.confirm') }}
        </label>
        <button
          type="submit"
          class="rounded border px-4 py-2 disabled:opacity-50"
          :disabled="locked || !version || !confirmed"
        >
          {{ t('page.sessionPolicy.force') }}
        </button>
      </form>
    </div>
  </AdminPage>
</template>
