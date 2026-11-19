<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Dropdown,
  Form,
  FormItem,
  Input,
  Menu,
  MenuItem,
  Modal,
} from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useSession } from '#/shared/session';
import { useErrorText } from '#/shared/ui/messages';

import SessionNotice from './SessionNotice.vue';

// Header account controls. Sign-out ends this application's session only; the
// shared SSO account and other applications keep their own sessions.
const forbiddenNicknameChars = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u;

const { t } = useI18n();
const errorText = useErrorText();
const session = useSession();
const save = useMutation();
const editing = ref(false);
const nickname = ref('');
const signOutError = ref('');

const locked = computed(() => save.busy.value || save.uncertain.value);
const trimmedNickname = computed(() => nickname.value.trim());
const validNickname = computed(() => {
  const codePoints = [...trimmedNickname.value].length;
  return (
    codePoints >= 1 &&
    codePoints <= 20 &&
    !forbiddenNicknameChars.test(trimmedNickname.value)
  );
});

const beforeUnload = (event: BeforeUnloadEvent) => {
  if (locked.value) event.preventDefault();
};
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));

function edit() {
  if (!save.uncertain.value) {
    save.dismiss();
    nickname.value = session.session.value?.profile.nickname ?? '';
  }
  editing.value = true;
}

function closeModal() {
  if (locked.value) return;
  editing.value = false;
}

async function submit() {
  const profile = session.session.value?.profile;
  if (!profile || !validNickname.value) return;
  if (
    await save.run(
      'profile',
      { nickname: trimmedNickname.value, revision: profile.revision },
      (body, key) => session.saveProfile(body, key),
    )
  ) {
    editing.value = false;
  }
}

async function retrySave() {
  if (await save.retry()) {
    editing.value = false;
  }
}

async function signOut(all: boolean) {
  signOutError.value = '';
  try {
    await session.signOut(all);
  } catch (error) {
    signOutError.value = errorCode(error);
  }
}

function choose({ key }: { key: number | string }) {
  if (key === 'profile') edit();
  else void signOut(key === 'all');
}
</script>

<template>
  <div class="me-4 flex items-center gap-2">
    <template v-if="session.state.value === 'member' && session.session.value">
      <Dropdown :trigger="['click']">
        <Button type="text">
          {{ session.session.value.profile.nickname }}
        </Button>
        <template #overlay>
          <Menu @click="choose">
            <MenuItem key="profile">
              {{ t('page.session.editNickname') }}
            </MenuItem>
            <MenuItem key="device">{{ t('page.session.signOut') }}</MenuItem>
            <MenuItem key="all">{{ t('page.session.signOutAll') }}</MenuItem>
          </Menu>
        </template>
      </Dropdown>
      <span v-if="signOutError" class="text-destructive text-xs">
        {{ errorText(signOutError) }}
      </span>
    </template>
    <Button
      v-else-if="session.state.value === 'guest'"
      type="primary"
      size="small"
      @click="session.signIn"
    >
      {{ t('page.session.signIn') }}
    </Button>
    <span
      v-else-if="session.state.value === 'error'"
      class="text-muted-foreground text-xs"
    >
      {{ t('page.session.unavailable') }}
      <Button type="link" size="small" @click="session.reload">
        {{ t('page.common.retry') }}
      </Button>
    </span>
    <SessionNotice />
    <Modal
      :open="editing"
      :title="t('page.session.editNickname')"
      :confirm-loading="save.busy.value"
      :closable="!locked"
      :keyboard="!locked"
      :mask-closable="false"
      :ok-text="
        t(save.uncertain.value ? 'page.common.retryOriginal' : 'page.common.save')
      "
      :ok-button-props="{ disabled: !save.uncertain.value && !validNickname }"
      :cancel-text="t('page.common.cancel')"
      :cancel-button-props="{ disabled: locked }"
      @ok="save.uncertain.value ? retrySave() : submit()"
      @cancel="closeModal"
    >
      <Form layout="vertical" @submit.prevent="save.uncertain.value ? retrySave() : submit()">
        <FormItem :label="t('page.session.nickname')" html-for="session-nickname">
          <Input
            id="session-nickname"
            v-model:value="nickname"
            :disabled="locked"
          />
        </FormItem>
      </Form>
      <Alert
        v-if="save.uncertain.value"
        type="warning"
        show-icon
        :message="t('page.common.uncertain')"
      />
      <Alert
        v-else-if="save.error.value"
        type="error"
        show-icon
        :message="errorText(save.error.value)"
      />
    </Modal>
  </div>
</template>
