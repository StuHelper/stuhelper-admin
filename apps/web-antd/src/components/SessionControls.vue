<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { useI18n } from '@vben/locales';

import { Avatar, Button, Dropdown, Input, Menu, MenuDivider, MenuItem, Modal, Tooltip } from 'ant-design-vue';

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
const editing = ref(false);
async function saveAndClose() {
  await save();
  if (!error.value) editing.value = false;
}
function onMenu({ key }: { key: number | string }) {
  if (key === 'profile') { nickname.value = current.value?.profile.nickname ?? ''; editing.value = true; }
  else void logout(key === 'signOutAll');
}
onMounted(reload);
</script>
<template>
  <div class="session-controls">
    <Dropdown v-if="current" :trigger="['click']" placement="bottomRight">
      <Button type="text" class="session-user" :loading="busy">
        <Avatar size="small" class="session-avatar">{{ [...current.profile.nickname][0] }}</Avatar>
        <span class="session-name">{{ current.profile.nickname }}</span>
      </Button>
      <template #overlay>
        <Menu @click="onMenu">
          <MenuItem key="profile">{{ t('page.auth.profile') }}</MenuItem>
          <MenuDivider />
          <MenuItem key="signOut">{{ t('page.auth.signOut') }}</MenuItem>
          <MenuItem key="signOutAll" danger>{{ t('page.auth.signOutAll') }}</MenuItem>
        </Menu>
      </template>
    </Dropdown>
    <Button v-else type="primary" size="small" @click="signIn">{{ t('page.auth.signIn') }}</Button>
    <span v-if="error" role="status" class="session-error">
      <Tooltip :title="t('page.auth.unavailable')"><span class="status-text">{{ t('page.auth.unavailable') }}</span></Tooltip>
      <Button size="small" @click="reload">{{ t('page.auth.retry') }}</Button>
    </span>
    <Modal v-model:open="editing" :title="t('page.auth.profile')" :ok-text="t('page.auth.save')" :confirm-loading="busy" :ok-button-props="{ disabled: !nickname.trim() }" @ok="saveAndClose">
      <label class="grid gap-1">{{ t('page.auth.nickname') }}<Input v-model:value="nickname" :maxlength="64" /></label>
    </Modal>
  </div>
</template>
<style scoped>
.session-controls { display: flex; align-items: center; gap: .5rem; max-width: 100%; white-space: nowrap; }
.session-user { display: inline-flex; align-items: center; gap: .4rem; max-width: 12rem; }
.session-name { overflow: hidden; text-overflow: ellipsis; }
.session-avatar { background: hsl(var(--primary)); flex: none; }
.session-error { display: inline-flex; align-items: center; gap: .4rem; color: hsl(var(--muted-foreground)); font-size: .85rem; }
@media (max-width: 767px) {
  .session-name, .status-text { display: none; }
}
</style>
