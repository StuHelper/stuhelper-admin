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
    <span v-if="error" role="status">{{ t('page.auth.unavailable') }}
      <button type="button" @click="reload">
        {{ t('page.auth.retry') }}
      </button></span>
  </div>
</template>
<style scoped>
.session-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  max-width: 100%;
  font-size: 0.85rem;
}
.session-controls button,
.session-controls input {
  font: inherit;
  min-height: 36px;
  padding: 0.3rem 0.6rem;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  max-width: 100%;
}
.session-controls form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.session-controls label {
  display: grid;
  gap: 0.25rem;
}
.session-controls summary {
  cursor: pointer;
}
</style>
