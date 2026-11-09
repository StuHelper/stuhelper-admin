<script setup lang="ts">
import type { Grant, Resource, StateChange } from './api';

import { computed, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, DatePicker, Descriptions, DescriptionsItem, Divider, Form, FormItem, Input, List, ListItem, Popconfirm, Select, Space, Tag, Textarea } from 'ant-design-vue';

import PricePanel from '#/features/billing/PricePanel.vue';
import { useAsync, useMutation, usePaged } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { localName, useResourcesApi } from './api';

/**
 * One managed resource: change its visibility and manage individual access
 * grants. Unlisting stops new access but keeps purchases; blocking stops all
 * downloads. Grants expire or are revoked one source at a time.
 */
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ changed: []; pending: [busy: boolean] }>();
const { t, locale } = useI18n();
const format = useFormat();
const api = useResourcesApi();
const changing = useMutation();
const granting = useMutation();
const status = ref<StateChange['state']>('unlisted');
const reason = ref('');
const subject = ref('');
const expires = ref<string>();
const success = ref('');
let grantId = crypto.randomUUID();

const entry = useAsync((signal) => api.item(props.id, signal));
const grants = usePaged(async (after, signal) => {
  const page = await api.grants(props.id, { after }, signal);
  return { items: page.items, next: page.next_cursor };
});
const resource = shallowRef<Resource>();
watch(
  () => entry.data.value,
  (value) => {
    resource.value = value;
  },
);
const version = computed(() => resource.value?.current ?? resource.value?.proposal);
watch(
  () => props.id,
  () => {
    void entry.reload();
    void grants.reload();
  },
  { immediate: true },
);
const pricing = ref(false);
watch([changing.busy, changing.uncertain, granting.busy, granting.uncertain, reason, subject, pricing], () => emit('pending', changing.busy.value || changing.uncertain.value || granting.busy.value || granting.uncertain.value || !!reason.value || !!subject.value || pricing.value));

async function change() {
  const current = resource.value;
  if (!current) return;
  success.value = '';
  const result = await changing.run(`state:${current.id}`, { revision: current.revision, state: status.value, reason: reason.value }, (body, key) => api.changeState(current.id, body, key));
  if (result) changed(result);
}
async function retryChange() {
  const result = await changing.retry();
  // The retried request returns the resource after the original change.
  if (result) changed(result as Resource);
}
function changed(result: Resource) {
  resource.value = result;
  reason.value = '';
  success.value = t('page.common.saved');
  emit('changed');
}

async function grant(existing?: Grant) {
  const id = existing?.id ?? grantId;
  const body = existing ? { revision: existing.revision, subject_key: existing.subject_key, revoked: true } : { revision: 0, subject_key: subject.value.trim(), revoked: false, ...(expires.value ? { expires_at: expires.value } : {}) };
  if (await granting.run(`grant:${id}`, body, (value, key) => api.putGrant(props.id, id, value, key))) granted();
}
async function retryGrant() {
  if (await granting.retry()) granted();
}
function granted() {
  grantId = crypto.randomUUID();
  subject.value = '';
  expires.value = undefined;
  void grants.reload();
}
</script>

<template>
  <LoadState :status="entry.status.value" :error="entry.error.value" @retry="entry.reload">
    <div v-if="resource && version" class="flex flex-col gap-4">
      <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
        <DescriptionsItem :label="t('page.resources.title')" :span="2">{{ version.metadata.title }}</DescriptionsItem>
        <DescriptionsItem :label="t('page.resources.category')">{{ localName(version.category.names, locale) }}</DescriptionsItem>
        <DescriptionsItem :label="t('page.common.status')"><Tag>{{ t(`page.resources.state.${resource.state}`) }}</Tag></DescriptionsItem>
        <DescriptionsItem :label="t('page.resources.access')">{{ t(`page.resources.accessLevel.${version.metadata.access}`) }}</DescriptionsItem>
        <DescriptionsItem :label="t('page.resources.origin')">{{ t(`page.resources.originKind.${version.metadata.origin.kind}`) }}</DescriptionsItem>
        <DescriptionsItem v-if="version.file" :label="t('page.resources.file')" :span="2">{{ version.file.filename }} · {{ format.bytes(version.file.size) }}</DescriptionsItem>
        <DescriptionsItem v-if="resource.proposal" :label="t('page.resources.proposal')" :span="2"><Tag color="orange">{{ t(`page.resources.versionState.${resource.proposal.state}`) }}</Tag></DescriptionsItem>
      </Descriptions>

      <Divider orientation="left">{{ t('page.resources.stateChange') }}</Divider>
      <Alert type="info" show-icon :message="t('page.resources.stateHint')" />
      <Form layout="vertical" @submit.prevent="change">
        <FormItem :label="t('page.resources.targetState')" html-for="managepanel-field-1">
          <Select id="managepanel-field-1" v-model:value="status" :disabled="changing.busy.value || changing.uncertain.value" :options="(['published', 'unlisted', 'blocked'] as const).map((value) => ({ value, label: t(`page.resources.state.${value}`) }))" />
        </FormItem>
        <FormItem :label="t('page.common.reason')" required html-for="managepanel-field-2">
          <Textarea id="managepanel-field-2" v-model:value="reason" :rows="3" :maxlength="2000" :disabled="changing.busy.value || changing.uncertain.value" />
        </FormItem>
        <MutationAlert :busy="changing.busy.value" :error="changing.error.value" :uncertain="changing.uncertain.value" :success="success" @retry="retryChange" />
        <Button class="mt-3" type="primary" html-type="submit" :loading="changing.busy.value" :disabled="changing.uncertain.value || !reason.trim()">{{ t('page.resources.applyState') }}</Button>
      </Form>

      <Divider orientation="left">{{ t('page.resources.price.title') }}</Divider>
      <PricePanel :resource-id="resource.id" @pending="pricing = $event" />

      <Divider orientation="left">{{ t('page.resources.grants') }}</Divider>
      <LoadState v-if="grants.items.value.length === 0" :status="grants.status.value" :error="grants.error.value" :empty="true" :empty-text="t('page.resources.noGrants')" @retry="grants.reload" />
      <List v-else size="small" bordered :data-source="grants.items.value">
        <template #renderItem="{ item }">
          <ListItem>
            <div class="flex min-w-0 flex-col">
              <span class="break-all font-mono text-xs">{{ item.subject_key }}</span>
              <span class="text-muted-foreground text-xs">{{ item.expires_at ? t('page.resources.expiresAt', { time: format.dateTime(item.expires_at) }) : t('page.resources.noExpiry') }}</span>
            </div>
            <template #actions>
              <Tag :color="item.revoked ? 'default' : 'green'">{{ t(item.revoked ? 'page.resources.revoked' : 'page.resources.active') }}</Tag>
              <Popconfirm v-if="!item.revoked" :title="t('page.resources.revokeConfirm')" @confirm="grant(item)">
                <Button size="small" danger :disabled="granting.busy.value || granting.uncertain.value">{{ t('page.resources.revoke') }}</Button>
              </Popconfirm>
            </template>
          </ListItem>
        </template>
      </List>
      <Button v-if="grants.next.value" size="small" @click="grants.loadMore">{{ t('page.common.loadMore') }}</Button>
      <Form layout="vertical" @submit.prevent="grant()">
        <FormItem :label="t('page.resources.subjectKey')" :extra="t('page.resources.subjectKeyHint')" required html-for="managepanel-field-3">
          <Input id="managepanel-field-3" v-model:value="subject" :maxlength="1024" :disabled="granting.busy.value || granting.uncertain.value" />
        </FormItem>
        <FormItem :label="t('page.resources.expiry')" html-for="managepanel-field-4">
          <DatePicker id="managepanel-field-4" v-model:value="expires" show-time value-format="YYYY-MM-DDTHH:mm:ssZ" :disabled="granting.busy.value || granting.uncertain.value" />
        </FormItem>
        <MutationAlert :busy="granting.busy.value" :error="granting.error.value" :uncertain="granting.uncertain.value" @retry="retryGrant" />
        <Space class="mt-3">
          <Button type="primary" html-type="submit" :loading="granting.busy.value" :disabled="granting.uncertain.value || !subject.trim()">{{ t('page.resources.grant') }}</Button>
        </Space>
      </Form>
    </div>
  </LoadState>
</template>
