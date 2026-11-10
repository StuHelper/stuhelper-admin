<script setup lang="ts">
import type { Decision, Task } from '../academic/api';
import type { Resource } from './api';

import { computed, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Checkbox, Descriptions, DescriptionsItem, Drawer, Form, FormItem, Select, Space, Table, Tag, Textarea } from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation, usePaged, useTask } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { arrayCursor, useAcademicAdmin } from '../academic/api';
import { useCampusId } from '../academic/campus';
import CampusPending from '../academic/CampusPending.vue';
import { attributeText, localName, pageSize, useResourcesApi } from './api';

/**
 * Review queue for first uploads, corrections and new file versions. The
 * pending version is read and downloaded through the review endpoint; the
 * published version stays available until a decision is applied.
 */
const { t, te, locale } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const moderation = useAcademicAdmin();
const api = useResourcesApi();
const deciding = useMutation();
const retrying = useMutation();
const download = useTask();
const school = useCampusId();
const taskState = ref('waiting');
const selected = shallowRef<Task>();
const entry = shallowRef<Resource>();
const openError = ref('');
const action = ref<Decision['action']>('publish');
const reason = ref('');
const success = ref('');
const lastResult = ref('');
const autoNext = ref(true);

const tasks = usePaged(async (after, signal) => {
  if (!school.value) return { items: [], next: '' };
  const rows = await moderation.tasks({ school_id: school.value, content_kind: 'resource', state: taskState.value, after, limit: pageSize }, signal);
  return { items: rows, next: arrayCursor(rows, (row) => row.id, pageSize) };
});
// Resource tasks reference "resource:<version id>".
const versionId = computed(() => selected.value?.submission.object_id.replace(/^resource:/, '') ?? '');
const version = computed(() => (entry.value?.proposal?.id === versionId.value ? entry.value?.proposal : entry.value?.current));
const busy = computed(() => deciding.busy.value || deciding.uncertain.value || retrying.busy.value || retrying.uncertain.value);
watch(school, () => {
  selected.value = undefined;
  void tasks.reload();
});
useLeaveGuard(() => (busy.value || reason.value ? t(deciding.uncertain.value ? 'page.common.leaveUncertain' : 'page.common.leaveUnsaved') : ''));
async function open(task: Task) {
  if (busy.value) return;
  openError.value = '';
  success.value = '';
  try {
    selected.value = await moderation.task(task.id);
    entry.value = await api.reviewVersion(versionId.value);
    action.value = entry.value.proposal ? 'publish' : 'hide';
    reason.value = '';
  } catch (error) {
    openError.value = errorCode(error);
    entry.value = undefined;
  }
}
function close() {
  if (busy.value || (reason.value && !window.confirm(t('page.common.leaveUnsaved')))) return;
  selected.value = undefined;
  entry.value = undefined;
}

async function decide() {
  const task = selected.value;
  const current = entry.value;
  if (!task || !current) return;
  const body = { revision: task.revision, decision: { id: '', object_id: task.submission.object_id, revision: current.revision, action: action.value, signed: false, reason: reason.value } };
  const result = await deciding.run(`decide:${task.id}`, body, (value, key) => moderation.decide(task.id, value, key));
  if (result) decided(result);
}
async function retryDecision() {
  const result = await deciding.retry();
  // The retried request returns the task of the original decision.
  if (result) decided(result as Task);
}
async function retryDelivery() {
  const task = selected.value;
  if (!task) return;
  const result = await retrying.run(`retry:${task.id}`, { revision: task.revision }, (value, key) => moderation.retryTask(task.id, value, key));
  if (result) decided(result);
}
async function decided(task: Task) {
  // Remember the following row first: the decided row may leave this filter.
  const following = neighbour(1);
  selected.value = task;
  reason.value = '';
  lastResult.value = `${version.value?.metadata.title ?? ''} · ${label(`page.moderation.taskState.${task.state}`)}`;
  success.value = lastResult.value;
  await tasks.reload();
  if (autoNext.value && following) await open(following);
}
function neighbour(step: number) {
  const rows = tasks.items.value;
  const index = rows.findIndex((row) => row.id === selected.value?.id);
  return index === -1 ? undefined : rows[index + step];
}
async function move(step: number) {
  const target = neighbour(step);
  if (!target || (reason.value && !window.confirm(t('page.common.leaveUnsaved')))) return;
  await open(target);
}
function save() {
  const file = version.value?.file;
  const id = version.value?.id;
  if (file && id) void download.run(() => api.downloadReviewFile(id, file.filename, file.size));
}

const label = (key: string) => (te(key) ? t(key) : (key.split('.').at(-1) ?? ''));
const columns = computed(() => [
  { key: 'kind', title: t('page.moderation.taskType') },
  { key: 'reason', title: t('page.common.reason'), ellipsis: true },
  { key: 'state', title: t('page.common.status') },
  { key: 'updated', title: t('page.common.updatedAt') },
  { key: 'action', title: t('page.common.operation') },
]);
// Ant Design Vue types table rows as Record<string, any>; each row comes from this page's typed data source.
</script>

<template>
  <AdminPage :title="t('page.resources.reviewTitle')" :description="t('page.resources.reviewIntro')">
    <div class="flex flex-col gap-3">
      <Alert v-if="lastResult" type="success" show-icon closable :message="lastResult" @close="lastResult = ''" />
      <Card :bordered="false">
        <Form layout="inline" class="flex flex-wrap gap-y-3" @submit.prevent="tasks.reload()">
          <FormItem :label="t('page.common.status')" html-for="reviewview-field-1">
            <Select id="reviewview-field-1" v-model:value="taskState" class="w-40" :options="['waiting', 'decided', 'applied', 'failed'].map((value) => ({ value, label: label(`page.moderation.taskState.${value}`) }))" />
          </FormItem>
          <FormItem>
            <Button type="primary" html-type="submit" :disabled="!school || busy">{{ t('page.common.search') }}</Button>
          </FormItem>
        </Form>
      </Card>
      <CampusPending v-if="!school" @ready="school = $event" />
      <Card v-else :bordered="false">
        <LoadState v-if="tasks.items.value.length === 0" :status="tasks.status.value" :error="tasks.error.value" :empty="true" :empty-text="t('page.moderation.empty')" @retry="tasks.reload" />
        <template v-else>
          <Table :columns="columns" :data-source="tasks.items.value" :pagination="false" row-key="id" size="middle" :scroll="{ x: 640 }">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'kind'">{{ label(`page.moderation.taskKind.${record.submission.kind}`) }}</template>
              <template v-else-if="column.key === 'reason'">{{ record.submission.reason === 'content_review' ? t('page.moderation.contentReview') : record.submission.reason }}</template>
              <template v-else-if="column.key === 'state'"><Tag>{{ label(`page.moderation.taskState.${record.state}`) }}</Tag></template>
              <template v-else-if="column.key === 'updated'">{{ format.dateTime(record.updated_at) }}</template>
              <template v-else-if="column.key === 'action'"><Button type="link" size="small" :disabled="busy" @click="open(record as Task)">{{ t('page.common.open') }}</Button></template>
            </template>
          </Table>
          <div class="mt-4 flex justify-center">
            <Button v-if="tasks.next.value" :loading="tasks.appending.value" @click="tasks.loadMore">{{ t('page.common.loadMore') }}</Button>
          </div>
        </template>
        <p v-if="openError" class="text-destructive mt-2" role="alert">{{ errorText(openError) }}</p>
      </Card>
    </div>

    <Drawer :open="!!selected && !!entry" :width="720" :title="t('page.resources.reviewDetail')" :mask-closable="false" destroy-on-close @close="close">
      <template #extra>
        <Space>
          <Checkbox v-model:checked="autoNext">{{ t('page.moderation.autoNext') }}</Checkbox>
          <Button size="small" :disabled="busy || !neighbour(-1)" @click="move(-1)">{{ t('page.moderation.previous') }}</Button>
          <Button size="small" :disabled="busy || !neighbour(1)" @click="move(1)">{{ t('page.moderation.next') }}</Button>
        </Space>
      </template>
      <div v-if="selected && entry && version" class="flex flex-col gap-4">
        <Descriptions :column="1" size="small" bordered>
          <DescriptionsItem :label="t('page.resources.title')">{{ version.metadata.title }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.resources.description')"><span class="whitespace-pre-wrap">{{ version.metadata.description || t('page.common.notProvided') }}</span></DescriptionsItem>
          <DescriptionsItem :label="t('page.resources.category')">{{ localName(version.category.names, locale) }}</DescriptionsItem>
          <DescriptionsItem v-for="field in version.category.fields" :key="field.key" :label="localName(field.names, locale)">{{ attributeText(field, version.metadata.attributes[field.key], locale) || t('page.common.notProvided') }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.resources.origin')">{{ t(`page.resources.originKind.${version.metadata.origin.kind}`) }}<template v-if="version.metadata.origin.source"> · {{ version.metadata.origin.source }}</template></DescriptionsItem>
          <DescriptionsItem v-if="version.metadata.origin.license" :label="t('page.resources.license')">{{ version.metadata.origin.license }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.resources.versionLabel')"><Tag>{{ t(`page.resources.versionState.${version.state}`) }}</Tag></DescriptionsItem>
          <DescriptionsItem v-if="version.file" :label="t('page.resources.file')">{{ version.file.filename }} · {{ format.bytes(version.file.size) }}</DescriptionsItem>
        </Descriptions>
        <Alert v-if="selected.submission.reason !== 'content_review' || selected.submission.evidence.length > 0" type="info" :message="label(`page.moderation.taskKind.${selected.submission.kind}`)">
          <template #description>
            <p class="whitespace-pre-wrap">{{ selected.submission.reason }}</p>
            <p v-for="item in selected.submission.evidence" :key="item">{{ item }}</p>
          </template>
        </Alert>
        <Space wrap>
          <Button v-if="version.file" :loading="download.busy.value" @click="save">{{ t('page.resources.downloadFile') }}</Button>
          <Tag>{{ label(`page.moderation.taskState.${selected.state}`) }}</Tag>
          <span v-if="selected.decision" class="text-sm">{{ t('page.moderation.decisionNote', { reason: selected.decision.reason }) }}</span>
        </Space>
        <p v-if="download.error.value" class="text-destructive" role="alert">{{ errorText(download.error.value) }}</p>
        <Form v-if="selected.state === 'waiting' || deciding.uncertain.value" layout="vertical" @submit.prevent="decide">
          <FormItem :label="t('page.moderation.action')" html-for="reviewview-field-2">
            <Select id="reviewview-field-2" v-model:value="action" :disabled="busy" :options="(['publish', 'hide', 'restore', 'delete', 'dismiss'] as const).map((value) => ({ value, label: t(`page.resources.reviewActions.${value}`) }))" />
          </FormItem>
          <FormItem :label="t('page.common.reason')" required html-for="reviewview-field-3">
            <Textarea id="reviewview-field-3" v-model:value="reason" :rows="3" :maxlength="2000" :disabled="busy" />
          </FormItem>
          <MutationAlert :busy="deciding.busy.value" :error="deciding.error.value" :uncertain="deciding.uncertain.value" :success="success" @retry="retryDecision" />
          <Button class="mt-3" type="primary" html-type="submit" :loading="deciding.busy.value" :disabled="deciding.uncertain.value || !reason.trim()">{{ t('page.moderation.applyDecision') }}</Button>
        </Form>
        <template v-else>
          <MutationAlert :busy="retrying.busy.value" :error="retrying.error.value" :uncertain="retrying.uncertain.value" :success="success" @retry="retrying.retry" />
          <Button v-if="selected.state === 'failed'" :loading="retrying.busy.value" @click="retryDelivery">{{ t('page.moderation.retryDelivery') }}</Button>
        </template>
      </div>
    </Drawer>
  </AdminPage>
</template>
