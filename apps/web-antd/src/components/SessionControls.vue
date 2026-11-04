<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { useI18n } from '@vben/locales';

import {
  getSession,
  saveProfile,
  type Session,
  signIn,
  signOut,
} from '../api/session';
const { t } = useI18n();
const busy = ref(false);
const current = ref<null | Session>(null);
const error = ref(false);
const nickname = ref('');
let pending: null | { key: string; nickname: string; revision: number } = null;
async function reload() {
  try {
    current.value = await getSession();
    nickname.value = current.value?.profile.nickname ?? '';
    error.value = false;
  } catch {
    error.value = true;
  }
}
async function logout(all: boolean) {
  busy.value = true;
  try {
    await signOut(all);
  } catch {
    error.value = true;
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (!current.value) return;
  if (
    !pending ||
    pending.nickname !== nickname.value ||
    pending.revision !== current.value.profile.revision
  )
    pending = {
      nickname: nickname.value,
      revision: current.value.profile.revision,
      key: crypto.randomUUID(),
    };
  busy.value = true;
  try {
    current.value.profile = await saveProfile(
      { nickname: pending.nickname, revision: pending.revision },
      pending.key,
    );
    pending = null;
    error.value = false;
  } catch {
    error.value = true;
  } finally {
    busy.value = false;
  }
}
onMounted(reload);
</script>
<template>
  <div class="session-controls">
    <template v-if="current">
      <span>{{ current.profile.nickname }}</span>
      <details>
        <summary>{{ t('page.auth.profile') }}</summary>
        <form @submit.prevent="save">
          <label>{{ t('page.auth.nickname')
            }}<input v-model="nickname" maxlength="64" required /></label>
          <button :disabled="busy" type="submit">
            {{ t('page.auth.save') }}
          </button>
        </form>
      </details>
      <button :disabled="busy" type="button" @click="logout(false)">
        {{ t('page.auth.signOut') }}
      </button>
      <button :disabled="busy" type="button" @click="logout(true)">
        {{ t('page.auth.signOutAll') }}
      </button>
    </template>
    <button v-else type="button" @click="signIn">
      {{ t('page.auth.signIn') }}
    </button>
    <span v-if="error" role="status"><span class="status-text">{{ t('page.auth.unavailable') }}</span>
      <button type="button" @click="reload">
        {{ t('page.auth.retry') }}
      </button></span>
  </div>
</template>
<style scoped>
.session-controls {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 100%;
  font-size: 0.85rem;
  white-space: nowrap;
}
.session-controls button,
.session-controls input {
  font: inherit;
  min-height: 32px;
  padding: 0.2rem 0.65rem;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: transparent;
  color: inherit;
  max-width: 100%;
}
.session-controls button:hover:not(:disabled) {
  border-color: hsl(var(--primary));
  color: hsl(var(--primary));
}
.session-controls [role='status'] {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: hsl(var(--muted-foreground));
}
.session-controls form {
  position: absolute;
  inset-block-start: calc(100% + 0.5rem);
  inset-inline-end: 0;
  z-index: 20;
  display: grid;
  gap: 0.5rem;
  min-width: 14rem;
  padding: 0.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--popover));
}
.session-controls label {
  display: grid;
  gap: 0.25rem;
}
.session-controls summary {
  cursor: pointer;
}
@media (max-width: 767px) {
  .session-controls .status-text {
    display: none;
  }
}
</style>
