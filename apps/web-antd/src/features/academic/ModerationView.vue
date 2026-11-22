<script setup lang="ts">
import type {
  AdminEntry,
  BatchPreview,
  BatchRequest,
  Decision,
  Task,
} from './api';

import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Drawer,
  Form,
  FormItem,
  List,
  ListItem,
  Select,
  Space,
  Table,
  Tag,
  Textarea,
} from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';
import ReasonPresets from '#/shared/ui/ReasonPresets.vue';
import { stateColor } from '#/shared/ui/state-color';

import { arrayCursor, pageSize, useAcademicAdmin } from './api';
import { useCampusId } from './campus';
import CampusPending from './CampusPending.vue';
import CategoryCounts from './CategoryCounts.vue';
import DecisionPanel from './DecisionPanel.vue';
import { violationCategories } from './violationCategories';

/**
 * Moderation workbench. "queue" lists moderation tasks (reviews, reports,
 * edit and delete requests, appeals); "content" lists review entries by state.
 */
const props = defineProps<{ mode: 'content' | 'queue' }>();
const { t, te } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useAcademicAdmin();
const school = useCampusId();
const filters = reactive({
  state: props.mode === 'queue' ? 'waiting' : '',
  kind: '',
  taskKind: '',
  category: '',
  range: undefined as [string, string] | undefined,
});
const selected = shallowRef<{ entryId?: string; taskId?: string }>();
const panelBusy = ref(false);
const panelDirty = ref(false);

const maxSkippedEmptyPages = 5;

const rows = usePaged<AdminEntry | Task>(async (after, signal) => {
  if (!school.value) return { items: [], next: '' };
  if (props.mode === 'queue') {
    const [from, until] = filters.range ?? [];
    let cursor = after;
    for (let step = 0; step < maxSkippedEmptyPages; step++) {
      const tasks = await api.tasks(
        {
          school_id: school.value,
          state: filters.state,
          kind: filters.taskKind,
          category: filters.category,
          content_kind: filters.kind,
          from,
          until,
          after: cursor,
          limit: pageSize,
        },
        signal,
      );
      const next = arrayCursor(tasks, (task) => task.id);
      // Resource reviews have their own queue.
      const visible = tasks.filter((task) => task.content_kind !== 'resource');
      if (visible.length > 0 || !next || next === cursor) {
        return { items: visible, next };
      }
      cursor = next;
    }
    return { items: [], next: cursor };
  }
  const page = await api.entries(
    {
      school_id: school.value,
      kind: filters.kind,
      state: filters.state,
      after,
      limit: pageSize,
    },
    signal,
  );
  return { items: page.items, next: page.next };
});
const tasks = computed(() =>
  rows.items.value.filter((row): row is Task => 'submission' in row),
);
const entries = computed(() =>
  rows.items.value.filter((row): row is AdminEntry => 'input' in row),
);
const locked = computed(
  () =>
    panelBusy.value ||
    panelDirty.value ||
    batch.busy.value ||
    batch.uncertain.value,
);

watch(
  school,
  () => {
    selected.value = undefined;
    if (!school.value) return;
    void rows.reload();
  },
  { immediate: true },
);

function canLeave() {
  return (
    !(panelBusy.value || panelDirty.value) ||
    window.confirm(t('page.common.leaveUnsaved'))
  );
}
useLeaveGuard(() => (panelBusy.value || panelDirty.value || batch.busy.value || batch.uncertain.value ? t(batch.uncertain.value ? 'page.common.leaveUncertain' : 'page.common.leaveUnsaved') : ''));
const lastResult = ref('');
const autoNext = ref(true);
function targetOf(row: AdminEntry | Task) {
  return 'submission' in row ? { taskId: row.id } : { entryId: row.id };
}
function neighbour(step: number) {
  const rows = visibleRows();
  const current = selected.value?.taskId ?? selected.value?.entryId;
  const index = rows.findIndex((row) => row.id === current);
  const row = index === -1 ? undefined : rows[index + step];
  return row ? targetOf(row) : undefined;
}
function visibleRows() {
  return props.mode === 'queue' ? tasks.value : entries.value;
}
function move(step: number) {
  const target = neighbour(step);
  if (target) open(target);
}
// A decision may remove its row from the filter, so find the next row before reloading.
async function decided(message: string) {
  const current = selected.value?.taskId ?? selected.value?.entryId;
  const following = neighbour(1);
  lastResult.value = message;
  await rows.reload();
  if (!autoNext.value) return;
  const fallback = visibleRows().find(
    (row) => row.id !== current && ('submission' in row ? row.state === 'waiting' : true),
  );
  const nextTarget = following ?? (fallback ? targetOf(fallback) : undefined);
  if (nextTarget) {
    panelDirty.value = false;
    selected.value = nextTarget;
  }
}
function open(target: { entryId?: string; taskId?: string }) {
  if (selected.value && !canLeave()) return;
  selected.value = target;
}
function close() {
  if (canLeave()) selected.value = undefined;
}
function pending(busy: boolean, dirty: boolean) {
  panelBusy.value = busy;
  panelDirty.value = dirty;
}

// Batch decisions: preview each item first, then apply with the preview token.
const batch = useMutation();
const chosen = ref<string[]>([]);
const batchAction = ref<Decision['action']>('hide');
const batchReason = ref('');
const preview = shallowRef<BatchPreview>();
const request = shallowRef<BatchRequest>();
const previewError = ref('');
const previewing = ref(false);
watch([chosen, batchAction, batchReason], () => {
  preview.value = undefined;
  request.value = undefined;
});
async function inspect() {
  previewing.value = true;
  previewError.value = '';
  try {
    const items: BatchRequest['items'] = [];
    for (const id of chosen.value) {
      const task = tasks.value.find((item) => item.id === id);
      if (!task) continue;
      const entry = await api.entry(task.submission.object_id);
      items.push({
        id,
        revision: task.revision,
        decision: {
          id: '',
          object_id: entry.id,
          revision: entry.revision,
          action: batchAction.value,
          reason: batchReason.value,
        },
      });
    }
    const draft = { items, preview_token: '' };
    preview.value = await api.previewBatch(draft, crypto.randomUUID());
    request.value = { ...draft, preview_token: preview.value.preview_token };
  } catch (error) {
    previewError.value = errorCode(error);
  } finally {
    previewing.value = false;
  }
}
async function applyBatch() {
  const body = request.value;
  if (!body) return;
  const result = await batch.run('batch', body, (value, key) =>
    api.applyBatch(value, key),
  );
  if (result) batchApplied(result);
}
async function retryBatch() {
  const result = await batch.retry();
  // The retried request is the original batch.
  if (result) batchApplied(result as BatchPreview);
}
// Clearing the selection resets the preview through the watcher, so the
// per-item delivery result is shown after that reset has run.
async function batchApplied(result: BatchPreview) {
  chosen.value = [];
  await nextTick();
  preview.value = result;
  request.value = undefined;
  void rows.reload();
}

function label(key: string) {
  return te(key) ? t(key) : (key.split('.').at(-1) ?? '');
}
const presetKeys = ['approved', 'abuse', 'spam', 'privacy', 'unsubstantiated'] as const;
const reasonPresets = computed(() =>
  presetKeys.map((key) => ({ key, text: t(`page.moderation.presets.${key}`) })),
);
const stateOptions = computed(() =>
  (props.mode === 'queue'
    ? ['waiting', 'decided', 'applied', 'failed']
    : ['pending', 'published', 'hidden', 'deleted']
  ).map((value) => ({
    value,
    label: label(props.mode === 'queue' ? `page.moderation.taskState.${value}` : `page.moderation.state.${value}`),
  })),
);
const taskColumns = computed(() => [
  { key: 'kind', title: t('page.moderation.taskType') },
  { key: 'category', title: t('page.moderation.category') },
  { key: 'reason', title: t('page.moderation.submissionNote'), ellipsis: true },
  { key: 'state', title: t('page.common.status') },
  { key: 'updated', title: t('page.common.updatedAt') },
  { key: 'action', title: t('page.common.operation') },
]);
const entryColumns = computed(() => [
  { key: 'title', title: t('page.moderation.content'), ellipsis: true },
  { key: 'kind', title: t('page.moderation.contentKind') },
  { key: 'state', title: t('page.common.status') },
  { key: 'published', title: t('page.moderation.publishedAt') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage
    :title="
      t(
        mode === 'queue'
          ? 'page.moderation.queueTitle'
          : 'page.moderation.contentTitle',
      )
    "
    :description="
      t(
        mode === 'queue'
          ? 'page.moderation.queueIntro'
          : 'page.moderation.contentIntro',
      )
    "
  >
    <div class="flex flex-col gap-3">
      <Alert v-if="lastResult" type="success" show-icon closable :message="lastResult" @close="lastResult = ''" />
      <Card :bordered="false">
        <Form
          layout="inline"
          class="flex flex-wrap gap-y-3"
          @submit.prevent="rows.reload()"
        >
          <FormItem :label="t('page.common.status')" html-for="moderationview-field-1">
            <Select
id="moderationview-field-1"
              v-model:value="filters.state"
              class="w-40"
              :disabled="locked"
              :options="[
                { value: '', label: t('page.common.all') },
                ...stateOptions,
              ]"
            />
          </FormItem>
          <FormItem :label="t('page.moderation.contentKind')" html-for="moderationview-field-2">
            <Select
id="moderationview-field-2"
              v-model:value="filters.kind"
              class="w-36"
              :disabled="locked"
              :options="[
                { value: '', label: t('page.common.all') },
                ...['course', 'mentor', 'reply'].map((value) => ({
                  value,
                  label: t(`page.moderation.kind.${value}`),
                })),
              ]"
            />
          </FormItem>
          <template v-if="mode === 'queue'">
            <FormItem :label="t('page.moderation.taskType')" html-for="moderationview-field-3">
              <Select
id="moderationview-field-3"
                v-model:value="filters.taskKind"
                class="w-36"
                :disabled="locked"
                :options="[
                  { value: '', label: t('page.common.all') },
                  ...[
                    'review',
                    'report',
                    'edit_request',
                    'delete_request',
                    'appeal',
                  ].map((value) => ({
                    value,
                    label: t(`page.moderation.taskKind.${value}`),
                  })),
                ]"
              />
            </FormItem>
            <FormItem :label="t('page.moderation.category')" html-for="moderationview-field-category">
              <Select
                id="moderationview-field-category"
                v-model:value="filters.category"
                class="w-44"
                show-search
                option-filter-prop="label"
                :disabled="locked"
                :options="[
                  { value: '', label: t('page.common.all') },
                  ...violationCategories.map((value) => ({ value, label: t(`page.moderation.categories.${value}`) })),
                ]"
              />
            </FormItem>
            <FormItem :label="t('page.moderation.timeRange')" html-for="moderationview-field-4">
              <DatePicker.RangePicker
                id="moderationview-field-4"
                v-model:value="filters.range"
                show-time
                value-format="YYYY-MM-DDTHH:mm:ssZ"
                :disabled="locked"
              />
            </FormItem>
          </template>
          <FormItem>
            <Button
              type="primary"
              html-type="submit"
              :disabled="locked || !school"
              >
{{ t('page.common.search') }}
</Button>
          </FormItem>
        </Form>
      </Card>

      <CampusPending v-if="!school" @ready="school = $event" />
      <CategoryCounts
        v-if="school && mode === 'queue'"
        :school="school"
        :active="filters.category"
        @pick="(value) => { if (!locked) { filters.category = value; void rows.reload(); } }"
      />
      <Card v-if="school" :bordered="false">
        <div v-if="rows.items.value.length === 0">
          <LoadState
            :status="rows.status.value"
            :error="rows.error.value"
            :empty="true"
            :empty-text="t('page.moderation.empty')"
            @retry="rows.reload"
          />
          <div
            v-if="rows.status.value === 'ready' && rows.next.value"
            class="mt-4 flex justify-center"
          >
            <Button
              :loading="rows.appending.value"
              :disabled="locked"
              @click="rows.loadMore"
            >
              {{ t('page.common.loadMore') }}
            </Button>
          </div>
        </div>
        <template v-else>
          <Table
            v-if="mode === 'queue'"
            :columns="taskColumns"
            :data-source="tasks"
            :pagination="false"
            row-key="id"
            size="middle"
            :scroll="{ x: 720 }"
            :row-selection="{
              selectedRowKeys: chosen,
              onChange: (keys: (string | number)[]) =>
                (chosen = keys.map(String).slice(0, 20)),
              getCheckboxProps: (row: Task) => ({
                disabled: row.state !== 'waiting' || locked,
              }),
            }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'kind'">
{{
                label(`page.moderation.taskKind.${record.submission.kind}`)
              }}
</template>
              <template v-else-if="column.key === 'category'">
{{
                (record.decision?.category ?? record.submission.category)
                  ? label(`page.moderation.categories.${record.decision?.category ?? record.submission.category}`)
                  : t('page.moderation.uncategorized')
              }}
</template>
              <template v-else-if="column.key === 'reason'">
{{
                record.submission.reason === 'content_review'
                  ? t('page.moderation.ruleReview')
                  : record.submission.reason
              }}
</template>
              <template v-else-if="column.key === 'state'">
<Tag :color="stateColor(record.state)">
{{
                  label(`page.moderation.taskState.${record.state}`)
                }}
</Tag>
</template>
              <template v-else-if="column.key === 'updated'">
{{
                format.dateTime(record.updated_at)
              }}
</template>
              <template v-else-if="column.key === 'action'">
                <Button
                  type="link"
                  size="small"
                  :disabled="panelBusy || batch.busy.value"
                  @click="open({ taskId: String(record.id) })"
                  >
{{ t('page.common.open') }}
</Button>
              </template>
            </template>
          </Table>
          <Table
            v-else
            :columns="entryColumns"
            :data-source="entries"
            :pagination="false"
            row-key="id"
            size="middle"
            :scroll="{ x: 720 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'title'">
{{
                record.input.title || record.input.body.slice(0, 60)
              }}
</template>
              <template v-else-if="column.key === 'kind'">
{{
                t(`page.moderation.kind.${record.input.kind}`)
              }}
</template>
              <template v-else-if="column.key === 'state'">
<Tag :color="stateColor(record.state)">{{ label(`page.moderation.state.${record.state}`) }}</Tag><Tag v-if="record.featured" color="green">
{{
                  t('page.moderation.featured')
                }}
</Tag>
</template>
              <template v-else-if="column.key === 'published'">
{{
                record.published_at
                  ? format.dateTime(record.published_at)
                  : t('page.common.notProvided')
              }}
</template>
              <template v-else-if="column.key === 'action'">
                <Button
                  type="link"
                  size="small"
                  :disabled="panelBusy"
                  @click="open({ entryId: String(record.id) })"
                  >
{{ t('page.common.open') }}
</Button>
              </template>
            </template>
          </Table>
          <div class="mt-4 flex justify-center">
            <Button
              v-if="rows.next.value"
              :loading="rows.appending.value"
              :disabled="locked"
              @click="rows.loadMore"
              >
{{ t('page.common.loadMore') }}
</Button>
          </div>
          <p
            v-if="rows.status.value === 'error'"
            class="text-destructive mt-2"
            role="alert"
          >
            {{ errorText(rows.error.value) }}
          </p>
        </template>
      </Card>

      <Card
        v-if="mode === 'queue' && school && (chosen.length > 0 || preview)"
        :bordered="false"
        :title="t('page.moderation.batchTitle')"
      >
        <p class="text-muted-foreground mb-4 text-sm">
          {{
            t('page.moderation.batchHint', {
              count: format.number(chosen.length),
            })
          }}
        </p>
        <Form layout="vertical">
          <FormItem :label="t('page.moderation.action')" html-for="moderationview-field-5">
            <Select
id="moderationview-field-5"
              v-model:value="batchAction"
              :disabled="batch.busy.value || batch.uncertain.value"
              :options="
                [
                  'publish',
                  'hide',
                  'restore',
                  'delete',
                  'feature',
                  'unfeature',
                  'dismiss',
                ].map((value) => ({
                  value,
                  label: t(`page.moderation.actions.${value}`),
                }))
              "
            />
          </FormItem>
          <FormItem :label="t('page.moderation.reason')" required html-for="moderationview-field-6">
            <ReasonPresets
              v-model="batchReason"
              :presets="reasonPresets"
              :disabled="batch.busy.value || batch.uncertain.value"
              :max-length="2000"
            />
            <Textarea
id="moderationview-field-6"
              v-model:value="batchReason"
              :rows="3"
              :maxlength="2000"
              :disabled="batch.busy.value || batch.uncertain.value"
            />
          </FormItem>
        </Form>
        <p v-if="previewError" class="text-destructive mb-2" role="alert">
          {{ errorText(previewError) }}
        </p>
        <List
          v-if="preview"
          size="small"
          bordered
          class="mb-4"
          :data-source="preview.items"
        >
          <template #renderItem="{ item }">
            <ListItem>
              <span class="font-mono text-xs">{{ item.id }}</span>
              <Tag :color="item.code ? 'red' : 'green'">
{{
                label(`page.moderation.batchState.${item.state}`)
              }}
</Tag>
              <span v-if="item.code" class="text-destructive text-sm">{{
                errorText(item.code)
              }}</span>
            </ListItem>
          </template>
        </List>
        <MutationAlert
          :busy="batch.busy.value"
          :error="batch.error.value"
          :uncertain="batch.uncertain.value"
          @retry="retryBatch"
        />
        <Space class="mt-4" wrap>
          <Button
            :loading="previewing"
            :disabled="
              batch.busy.value ||
              batch.uncertain.value ||
              chosen.length === 0 ||
              !batchReason.trim()
            "
            @click="inspect"
            >
{{ t('page.moderation.previewBatch') }}
</Button>
          <Button
            v-if="request"
            type="primary"
            :loading="batch.busy.value"
            :disabled="batch.uncertain.value"
            @click="applyBatch"
            >
{{ t('page.moderation.applyBatch') }}
</Button>
          <Button
            :disabled="batch.busy.value || batch.uncertain.value"
            @click="
              chosen = [];
              batchReason = '';
              preview = undefined;
            "
            >
{{ t('page.common.cancel') }}
</Button>
        </Space>
      </Card>
    </div>

    <Drawer
      :open="!!selected"
      :width="760"
      :title="t('page.moderation.detailTitle')"
      :mask-closable="false"
      destroy-on-close
      @close="close"
    >
      <!-- Navigation sits in the body so narrow screens keep the title and close button readable. -->
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Checkbox v-model:checked="autoNext">{{ t('page.moderation.autoNext') }}</Checkbox>
        <Space>
          <Button size="small" :disabled="panelBusy || !neighbour(-1)" @click="move(-1)">{{ t('page.moderation.previous') }}</Button>
          <Button size="small" :disabled="panelBusy || !neighbour(1)" @click="move(1)">{{ t('page.moderation.next') }}</Button>
        </Space>
      </div>
      <DecisionPanel
        v-if="selected"
        @decided="decided"
        :key="selected.taskId ?? selected.entryId"
        :school-id="school"
        :task-id="selected.taskId"
        :entry-id="selected.entryId"
        @pending="pending"
        @changed="rows.reload"
      />
    </Drawer>
  </AdminPage>
</template>
