<script setup lang="ts">
import type { Application, ReviewInput, Scope } from './api';

import { computed, onMounted, reactive, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Card, Checkbox, CheckboxGroup, Descriptions, DescriptionsItem, Drawer, Form, FormItem, InputNumber, Radio, RadioGroup, Segmented, Table, Tag, Textarea } from 'ant-design-vue';

import { useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { policyLimits, scopes, useOpenPlatformAdmin } from './api';

/**
 * Review developer applications. Approval names the scopes and limits that
 * apply; users still consent scope by scope. Suspending revokes existing user
 * grants, and approving again does not restore them.
 */
type Filter = 'all' | Application['state'];
const { t } = useI18n();
const format = useFormat();
const api = useOpenPlatformAdmin();
const apps = usePaged<Application>((after, signal) => api.apps(after, signal));
onMounted(apps.reload);
const filter = ref<Filter>('pending');
const rows = computed(() => apps.items.value.filter((app) => filter.value === 'all' || app.state === filter.value));
const stateColor: Record<Application['state'], string> = { pending: 'blue', changes_requested: 'orange', active: 'green', suspended: 'red' };

const selected = shallowRef<Application>();
const form = reactive({ decision: 'approve' as ReviewInput['decision'], scopes: [] as Scope[], grantDays: 180, tokenMinutes: 60, dailyQuota: 1000, note: '' });
const baseline = ref('');
const review = useMutation();
const success = ref('');
const dirty = computed(() => !!selected.value && JSON.stringify(form) !== baseline.value);
const noteRequired = computed(() => form.decision !== 'approve');
const valid = computed(() => (form.decision === 'approve' ? form.scopes.length > 0 : !!form.note.trim()));
const decisions = computed<ReviewInput['decision'][]>(() => (selected.value?.state === 'active' ? ['approve', 'suspend'] : (selected.value?.state === 'suspended' ? ['approve'] : ['approve', 'changes_requested', 'suspend'])));
useLeaveGuard(() => (review.uncertain.value ? t('page.common.leaveUncertain') : (dirty.value || review.busy.value ? t('page.common.leaveUnsaved') : '')));

function open(app: Application) {
  if (selected.value && dirty.value && !window.confirm(t('page.common.leaveUnsaved'))) return;
  selected.value = app;
  success.value = '';
  // Start from what was approved before; a first review starts from the request.
  const approved = app.approved_scopes.length > 0 ? app.approved_scopes : app.requested_scopes;
  Object.assign(form, {
    decision: 'approve',
    scopes: approved.filter((scope) => app.requested_scopes.includes(scope)),
    grantDays: Math.round(app.policy.grant_seconds / 86_400) || 180,
    tokenMinutes: Math.round(app.policy.token_seconds / 60) || 60,
    dailyQuota: app.policy.daily_quota || 1000,
    note: '',
  });
  baseline.value = JSON.stringify(form);
}
function close() {
  if (review.busy.value || review.uncertain.value || (dirty.value && !window.confirm(t('page.common.leaveUnsaved')))) return;
  selected.value = undefined;
}
async function submit() {
  const app = selected.value;
  if (!app || !valid.value) return;
  const body: ReviewInput = {
    revision: app.revision,
    decision: form.decision,
    approved_scopes: form.decision === 'approve' ? scopes.filter((scope) => form.scopes.includes(scope)) : [],
    policy: { grant_seconds: form.grantDays * 86_400, token_seconds: form.tokenMinutes * 60, daily_quota: form.dailyQuota },
    note: form.note.trim(),
  };
  const result = await review.run(`review:${app.id}:${app.revision}`, body, (value, key) => api.review(app.id, value, key));
  if (result) reviewed(result);
}
async function retry() {
  const result = await review.retry();
  // The retried request is the original review and returns the Application.
  if (result) reviewed(result as Application);
}
function reviewed(app: Application) {
  apps.items.value = apps.items.value.map((item) => (item.id === app.id ? app : item));
  selected.value = app;
  baseline.value = JSON.stringify(form);
  success.value = t(`page.openPlatform.reviewed.${app.state}`);
}
async function reloadCompare() {
  await apps.reload();
  const current = apps.items.value.find((item) => item.id === selected.value?.id);
  if (current) selected.value = current;
}
const columns = computed(() => [
  { key: 'name', title: t('page.openPlatform.name') },
  { key: 'type', title: t('page.openPlatform.clientType') },
  { key: 'scopes', title: t('page.openPlatform.requested') },
  { key: 'state', title: t('page.common.status') },
  { key: 'created', title: t('page.common.createdAt') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage :title="t('page.openPlatform.title')" :description="t('page.openPlatform.intro')">
    <Card :bordered="false">
      <Segmented
        v-model:value="filter"
        class="mb-4"
        :options="(['pending', 'changes_requested', 'active', 'suspended', 'all'] as const).map((value) => ({ value, label: value === 'all' ? t('page.common.all') : t(`page.openPlatform.state.${value}`) }))"
      />
      <LoadState
        v-if="rows.length === 0"
        :status="apps.status.value"
        :error="apps.error.value"
        :empty="true"
        :empty-text="t('page.openPlatform.empty')"
        @retry="apps.reload"
      />
      <template v-else>
        <Table :columns="columns" :data-source="rows" :pagination="false" row-key="id" size="middle" :scroll="{ x: 760 }">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <div class="font-medium">{{ record.name }}</div>
              <code class="text-muted-foreground text-xs">{{ record.id }}</code>
            </template>
            <template v-else-if="column.key === 'type'">{{ t(`page.openPlatform.clientTypes.${record.client_type}`) }}</template>
            <template v-else-if="column.key === 'scopes'">
              <Tag v-for="scope in record.requested_scopes" :key="scope" :color="record.approved_scopes.includes(scope) ? 'green' : undefined">{{ t(`page.openPlatform.scopes.${scope}`) }}</Tag>
            </template>
            <template v-else-if="column.key === 'state'"><Tag :color="stateColor[record.state as Application['state']]">{{ t(`page.openPlatform.state.${record.state}`) }}</Tag></template>
            <template v-else-if="column.key === 'created'">{{ format.dateTime(record.created_at) }}</template>
            <template v-else-if="column.key === 'action'">
              <Button type="link" size="small" @click="open(record as Application)">{{ t('page.openPlatform.review') }}</Button>
            </template>
          </template>
        </Table>
        <div class="mt-4 flex justify-center">
          <Button v-if="apps.next.value" :loading="apps.appending.value" @click="apps.loadMore">{{ t('page.common.loadMore') }}</Button>
        </div>
      </template>
    </Card>

    <Drawer :open="!!selected" width="min(640px, 100vw)" :title="selected?.name" :mask-closable="false" destroy-on-close @close="close">
      <div v-if="selected" class="flex flex-col gap-4">
        <Descriptions :column="1" size="small" bordered>
          <DescriptionsItem :label="t('page.openPlatform.clientId')"><code>{{ selected.id }}</code></DescriptionsItem>
          <DescriptionsItem :label="t('page.common.status')"><Tag :color="stateColor[selected.state]">{{ t(`page.openPlatform.state.${selected.state}`) }}</Tag></DescriptionsItem>
          <DescriptionsItem :label="t('page.openPlatform.clientType')">{{ t(`page.openPlatform.clientTypes.${selected.client_type}`) }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.openPlatform.purpose')"><span class="whitespace-pre-wrap">{{ selected.purpose }}</span></DescriptionsItem>
          <DescriptionsItem :label="t('page.openPlatform.redirects')">
            <code v-for="uri in selected.redirect_uris" :key="uri" class="block break-all">{{ uri }}</code>
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.common.revision')">{{ format.number(selected.revision) }}</DescriptionsItem>
          <DescriptionsItem v-if="selected.note" :label="t('page.openPlatform.lastNote')">{{ selected.note }}</DescriptionsItem>
        </Descriptions>

        <Form layout="vertical" @submit.prevent="submit">
          <FormItem :label="t('page.openPlatform.decision')">
            <RadioGroup v-model:value="form.decision" :disabled="review.busy.value || review.uncertain.value">
              <Radio v-for="value in decisions" :key="value" :value="value">{{ t(`page.openPlatform.decisions.${value}`) }}</Radio>
            </RadioGroup>
          </FormItem>
          <p class="text-muted-foreground -mt-2 mb-4 text-sm">{{ t(`page.openPlatform.decisionHint.${form.decision}`) }}</p>
          <template v-if="form.decision === 'approve'">
            <FormItem :label="t('page.openPlatform.approvedScopes')">
              <CheckboxGroup v-model:value="form.scopes" :disabled="review.busy.value || review.uncertain.value" class="flex flex-col gap-1">
                <Checkbox v-for="scope in selected.requested_scopes" :key="scope" :value="scope">{{ t(`page.openPlatform.scopes.${scope}`) }}</Checkbox>
              </CheckboxGroup>
            </FormItem>
            <div class="grid gap-x-4 sm:grid-cols-3">
              <FormItem :label="t('page.openPlatform.grantDays')" html-for="open-platform-grant">
                <InputNumber id="open-platform-grant" v-model:value="form.grantDays" class="w-full" :min="1" :max="policyLimits.grantDays" :precision="0" :disabled="review.busy.value || review.uncertain.value" />
              </FormItem>
              <FormItem :label="t('page.openPlatform.tokenMinutes')" html-for="open-platform-token">
                <InputNumber id="open-platform-token" v-model:value="form.tokenMinutes" class="w-full" :min="1" :max="policyLimits.tokenMinutes" :precision="0" :disabled="review.busy.value || review.uncertain.value" />
              </FormItem>
              <FormItem :label="t('page.openPlatform.dailyQuota')" html-for="open-platform-quota">
                <InputNumber id="open-platform-quota" v-model:value="form.dailyQuota" class="w-full" :min="0" :max="policyLimits.dailyQuota" :precision="0" :disabled="review.busy.value || review.uncertain.value" />
              </FormItem>
            </div>
          </template>
          <FormItem :label="t(noteRequired ? 'page.openPlatform.noteRequired' : 'page.openPlatform.noteOptional')" :required="noteRequired" html-for="open-platform-note">
            <Textarea id="open-platform-note" v-model:value="form.note" :rows="3" :maxlength="1000" :disabled="review.busy.value || review.uncertain.value" />
          </FormItem>
          <MutationAlert :busy="review.busy.value" :error="review.error.value" :uncertain="review.uncertain.value" :success="success" @retry="retry" />
          <div class="mt-4 flex flex-wrap gap-2">
            <Button type="primary" html-type="submit" :danger="form.decision === 'suspend'" :loading="review.busy.value" :disabled="!valid || review.uncertain.value">
              {{ t(`page.openPlatform.submit.${form.decision}`) }}
            </Button>
            <Button v-if="review.error.value === 'conflict'" :disabled="review.busy.value" @click="reloadCompare">{{ t('page.common.reloadCompare') }}</Button>
          </div>
        </Form>
      </div>
    </Drawer>
  </AdminPage>
</template>
