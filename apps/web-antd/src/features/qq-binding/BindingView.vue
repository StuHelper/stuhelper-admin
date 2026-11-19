<script setup lang="ts">
import type { Part, Status } from './api';

import { computed, onMounted, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Form, FormItem, Input, List, ListItem, Modal, Tag, Textarea } from 'ant-design-vue';

import { useAccountJump } from '#/shared/account-jump';
import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useSession } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { parts, useQqBindingAdmin } from './api';

/**
 * Look up one account's QQ binding and release a part, for example when an
 * identity was bound to the wrong StuHelper account. Each lookup is audited.
 */
const { t } = useI18n();
const errorText = useErrorText();
const api = useQqBindingAdmin();
const accountJump = useAccountJump();
const session = useSession();

const owner = ref('');
const prefilled = ref(false);
const shown = ref('');
const success = ref('');
const status = shallowRef<Status>();
const loading = ref(false);
const lookupError = ref('');

onMounted(() => {
  const jumped = accountJump.consume('qqBinding');
  if (jumped) {
    owner.value = jumped.principalKey;
    prefilled.value = true;
  }
});

let requestVersion = 0;
async function lookup() {
  const key = owner.value.trim();
  if (!key || loading.value) return;
  const version = ++requestVersion;
  shown.value = '';
  loading.value = true;
  lookupError.value = '';
  prefilled.value = false;
  status.value = undefined;
  success.value = '';
  try {
    const current = await api.inspect(key);
    if (version !== requestVersion) return;
    status.value = current;
    shown.value = key;
  } catch (error) {
    if (version === requestVersion) lookupError.value = errorCode(error);
  } finally {
    loading.value = false;
  }
}

const releasing = ref<Part>();
const reason = ref('');
const comparing = ref(false);
const release = useMutation();
const locked = computed(() => release.busy.value || release.uncertain.value);
function clearInspection() {
  requestVersion++;
  status.value = undefined;
  shown.value = '';
  releasing.value = undefined;
  comparing.value = false;
  reason.value = '';
}
watch(session.state, (state, prev) => {
  if (prev === 'member' && state === 'guest') clearInspection();
});
watch(release.error, (code) => {
  if (code === 'forbidden' || code === 'unauthenticated') clearInspection();
});
useLeaveGuard(() => (release.uncertain.value ? t('page.common.leaveUncertain') : ((releasing.value && reason.value) || release.busy.value ? t('page.common.leaveUnsaved') : '')));
function startRelease(part: Part) {
  releasing.value = part;
  reason.value = '';
  comparing.value = false;
  release.dismiss();
}
async function confirmRelease() {
  const part = releasing.value;
  const current = status.value;
  if (!part || !current || !reason.value.trim()) return;
  const body = { kind: part, revision: current[part].revision, reason: reason.value.trim() };
  const result = await release.run(`release:${shown.value}:${part}:${body.revision}`, body, (value, key) => api.release(shown.value, value, key));
  if (result) released(part, result);
}
async function retry() {
  const part = releasing.value;
  const result = await release.retry();
  // The retried request is the original release and returns the current Status.
  if (part && result) released(part, result as Status);
}
function released(part: Part, result: Status) {
  status.value = result;
  releasing.value = undefined;
  comparing.value = false;
  success.value = t('page.qqBinding.released', { part: t(`page.qqBinding.parts.${part}`) });
}
async function reloadCompare() {
  if (!shown.value) return;
  const version = ++requestVersion;
  try {
    const refreshed = await api.inspect(shown.value);
    if (version !== requestVersion) return;
    status.value = refreshed;
    release.dismiss();
    comparing.value = true;
  } catch (error) {
    if (version !== requestVersion) return;
    const code = errorCode(error);
    lookupError.value = code;
    if (code === 'forbidden' || code === 'unauthenticated') clearInspection();
    else releasing.value = undefined;
  }
}
const savedPartSummary = computed(() => {
  const part = releasing.value;
  const current = status.value;
  if (!part || !current) return '';
  return `${t(`page.qqBinding.parts.${part}`)}: ${t(current[part].bound ? 'page.qqBinding.bound' : 'page.qqBinding.unbound')}`;
});
function cancelRelease() {
  if (!locked.value) releasing.value = undefined;
}
</script>

<template>
  <AdminPage :title="t('page.qqBinding.title')" :description="t('page.qqBinding.intro')">
    <div class="flex flex-col gap-4">
      <Card :bordered="false">
        <Alert v-if="prefilled" class="mb-4" type="info" show-icon closable :message="t('page.accountJump.prefilledHint')" @close="prefilled = false" />
        <Form layout="vertical" class="max-w-2xl" @submit.prevent="lookup">
          <FormItem :label="t('page.qqBinding.owner')" :extra="t('page.qqBinding.ownerHint')" html-for="qq-binding-owner">
            <Input id="qq-binding-owner" v-model:value="owner" :maxlength="2048" allow-clear autocomplete="off" />
          </FormItem>
          <Button type="primary" html-type="submit" :loading="loading" :disabled="!owner.trim()">{{ t('page.qqBinding.lookup') }}</Button>
        </Form>
      </Card>
      <Alert v-if="lookupError" type="error" show-icon role="alert" :message="errorText(lookupError)" />
      <Card v-if="status" :bordered="false" :title="t('page.qqBinding.result')">
        <Alert class="mb-4" :type="status.complete ? 'success' : 'warning'" show-icon :message="t(status.complete ? 'page.qqBinding.complete' : 'page.qqBinding.incomplete')" />
        <p v-if="status.qq_number" class="mb-4">{{ t('page.qqBinding.number', { number: status.qq_number }) }}</p>
        <List bordered :data-source="parts">
          <template #renderItem="{ item }">
            <ListItem>
              <div class="flex w-full flex-wrap items-center justify-between gap-2">
                <span class="font-medium">{{ t(`page.qqBinding.parts.${item}`) }}</span>
                <span class="flex items-center gap-2">
                  <Tag :color="status[item as Part].bound ? 'green' : undefined">{{ t(status[item as Part].bound ? 'page.qqBinding.bound' : 'page.qqBinding.unbound') }}</Tag>
                  <Button v-if="status[item as Part].bound" danger size="small" :disabled="locked" @click="startRelease(item as Part)">{{ t('page.qqBinding.release') }}</Button>
                </span>
              </div>
            </ListItem>
          </template>
        </List>
        <Alert v-if="success" class="mt-4" type="success" show-icon role="status" :message="success" />
      </Card>
    </div>

    <Modal :open="!!releasing" :closable="!locked" :keyboard="!locked" :title="releasing ? t('page.qqBinding.releaseTitle', { part: t(`page.qqBinding.parts.${releasing}`) }) : ''" :footer="null" :mask-closable="false" @cancel="cancelRelease">
      <Alert v-if="comparing" class="mb-3" type="info" show-icon :message="t('page.common.compareNotice')" :description="savedPartSummary" />
      <p class="text-muted-foreground mb-4 text-sm">{{ t('page.qqBinding.releaseHint') }}</p>
      <Form layout="vertical" @submit.prevent="confirmRelease">
        <FormItem :label="t('page.qqBinding.reason')" required html-for="qq-binding-reason">
          <Textarea id="qq-binding-reason" v-model:value="reason" :rows="3" :maxlength="1000" :disabled="locked" />
        </FormItem>
        <MutationAlert :busy="release.busy.value" :error="release.error.value" :uncertain="release.uncertain.value" @retry="retry" />
        <div class="mt-4 flex flex-wrap gap-2">
          <Button v-if="status && releasing && status[releasing].bound" danger type="primary" html-type="submit" :loading="release.busy.value" :disabled="!reason.trim() || release.uncertain.value">{{ t('page.qqBinding.confirmRelease') }}</Button>
          <Button :disabled="locked" @click="cancelRelease">{{ t('page.common.cancel') }}</Button>
          <Button v-if="release.error.value === 'qq_binding_revision_conflict'" :disabled="locked" @click="reloadCompare">{{ t('page.common.reloadCompare') }}</Button>
        </div>
      </Form>
    </Modal>
  </AdminPage>
</template>
