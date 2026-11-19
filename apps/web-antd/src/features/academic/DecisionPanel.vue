<script setup lang="ts">
import type { AttributionPreview, CatalogObject, Decision, Task } from './api';

import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  CollapsePanel,
  Descriptions,
  DescriptionsItem,
  Form,
  FormItem,
  Select,
  Space,
  Tag,
  Textarea,
  Timeline,
  TimelineItem,
} from 'ant-design-vue';

import { ApiError, errorCode } from '#/shared/api/errors';
import { useAsync, useMutation, usePaged } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';
import ReasonPresets from '#/shared/ui/ReasonPresets.vue';
import { stateColor } from '#/shared/ui/state-color';

import { dimensions, pageSize, useAcademicAdmin } from './api';
import { diffText } from './textDiff';
import { useTaskPoll } from './useTaskPoll';

/**
 * Review one entry, optionally through an existing moderation task. A decision
 * is saved first and applied by the content module afterwards; the panel shows
 * "applied" only once the task reports it.
 */
const props = withDefaults(
  defineProps<{ entryId?: string; schoolId: string; taskId?: string }>(),
  { entryId: undefined, taskId: undefined },
);
const emit = defineEmits<{
  changed: [];
  decided: [message: string];
  pending: [busy: boolean, dirty: boolean];
}>();
const presetKeys = ['approved', 'abuse', 'spam', 'privacy', 'unsubstantiated'] as const;

const { t, te } = useI18n();
const format = useFormat();
const api = useAcademicAdmin();
const opening = useMutation();
const deciding = useMutation();
const retrying = useMutation();
const task = shallowRef<Task>();
const action = ref<Decision['action']>();
const body = ref('');
const reason = ref('');
const signed = ref(false);
const teacher = ref('');
const attribution = shallowRef<AttributionPreview>();
const attributionError = ref('');
const success = ref('');
const showDiff = ref(true);
const baseline = ref('');
const form = () =>
  JSON.stringify([
    action.value,
    body.value,
    reason.value,
    signed.value,
    teacher.value,
  ]);
const dirty = computed(
  () => baseline.value !== '' && baseline.value !== form(),
);
const busy = computed(
  () => opening.busy.value || deciding.busy.value || retrying.busy.value,
);
const uncertain = computed(
  () =>
    opening.uncertain.value ||
    deciding.uncertain.value ||
    retrying.uncertain.value,
);

const data = useAsync(async (signal) => {
  const taskId = task.value?.id ?? props.taskId;
  const record = taskId ? await api.task(taskId, signal) : undefined;
  const entryId = record?.submission.object_id ?? props.entryId;
  if (!entryId) throw new ApiError('invalid_input');
  const entry = await api.entry(entryId, signal);
  // A task must not open content outside the selected school.
  if (entry.school_id !== props.schoolId) throw new ApiError('forbidden');
  const [teachers, objects] = await Promise.all([
    entry.input.kind === 'course'
      ? api.options(
          {
            kind: 'teacher',
            course_id: entry.input.target_id,
            school_id: entry.school_id,
          },
          signal,
        )
      : Promise.resolve([]),
    api
      .lookup([entry.input.target_id, entry.input.term_id], signal)
      .catch(() => new Map<string, CatalogObject>()),
  ]);
  return { entry, objects, task: record, teachers };
});
const entry = computed(() => data.data.value?.entry);
const targetLabel = computed(() => {
  const current = entry.value;
  if (!current) return '';
  const found = data.data.value?.objects.get(current.input.target_id);
  if (!found) return current.input.target_id;
  return found.code ? `${found.name} (${found.code})` : found.name;
});
const termLabel = computed(() => {
  const termId = entry.value?.input.term_id;
  if (!termId) return '';
  return data.data.value?.objects.get(termId)?.name ?? termId;
});
const proposedSegments = computed(() => {
  const current = entry.value;
  const proposed = task.value?.submission.proposed_body;
  if (!current || !proposed) return [];
  return diffText(current.input.body, proposed);
});
const reasonPresets = computed(() =>
  presetKeys.map((key) => ({ key, text: t(`page.moderation.presets.${key}`) })),
);

const related = useAsync(async (signal) =>
  entry.value
    ? api.tasks(
        { school_id: props.schoolId, object_id: entry.value.id, limit: 100 },
        signal,
      )
    : [],
);
const versions = usePaged(async (before, signal) => {
  if (!entry.value) return { items: [], next: '' };
  const rows = await api.history(
    entry.value.id,
    { ...(before ? { before } : {}), limit: pageSize },
    signal,
  );
  const last = rows.at(-1);
  return {
    items: rows,
    next: rows.length === pageSize && last ? String(last.revision) : '',
  };
});
function versionSegments(index: number, versionBody: string) {
  const older = versions.items.value[index + 1]?.input.body;
  if (older !== undefined) return diffText(older, versionBody);
  return [];
}

async function load(preserve = false) {
  await data.reload();
  const result = data.data.value;
  if (!result) return;
  task.value = result.task;
  void related.reload();
  void versions.reload();
  if (preserve) return;
  opening.dismiss();
  deciding.dismiss();
  retrying.dismiss();
  action.value = undefined;
  body.value = result.task?.submission.proposed_body || result.entry.input.body;
  reason.value = '';
  signed.value = !result.entry.anonymous;
  teacher.value = result.entry.input.teacher_id ?? '';
  baseline.value = form();
}

const actions = computed<Decision['action'][]>(() => {
  const current = entry.value;
  if (!current) return [];
  if (task.value?.submission.append_id) return ['approve_append', 'reject_append'];
  const values: Decision['action'][] = [];
  if (current.state === 'pending' || current.review_requested) values.push('publish');
  if (current.state === 'published')
    values.push('hide', current.featured ? 'unfeature' : 'feature');
  if (current.state === 'hidden' || current.state === 'deleted')
    values.push('restore');
  values.push('edit', 'identity');
  if (current.input.kind === 'course') values.push('reassign');
  if (current.state !== 'deleted') values.push('delete');
  if (task.value) values.push('dismiss');
  return values;
});
const editable = computed(
  () =>
    !task.value ||
    task.value.state === 'waiting' ||
    deciding.uncertain.value ||
    opening.uncertain.value,
);
const teacherNames = computed(
  () =>
    new Map(
      (data.data.value?.teachers ?? []).map((item) => [item.id, item.name]),
    ),
);

watch([action, teacher], () => {
  attribution.value = undefined;
});
watch(
  () => [props.taskId, props.entryId, props.schoolId],
  () => {
    task.value = undefined;
    success.value = '';
    attributionError.value = '';
    opening.dismiss();
    deciding.dismiss();
    retrying.dismiss();
    void load();
  },
  { immediate: true },
);
watch(
  [busy, uncertain, dirty],
  () => emit('pending', busy.value || uncertain.value, dirty.value),
  { immediate: true },
);

async function inspectAttribution() {
  const current = entry.value;
  if (!current) return;
  attributionError.value = '';
  try {
    attribution.value = await api.previewAttribution(
      current.id,
      { teacher_id: teacher.value },
      crypto.randomUUID(),
    );
  } catch (error) {
    attributionError.value = errorCode(error);
  }
}

async function decide() {
  const current = entry.value;
  const chosen = action.value;
  if (!current || !chosen || (chosen === 'reassign' && !attribution.value))
    return;
  success.value = '';
  // A direct content action first opens a review task that records the decision.
  if (!task.value) {
    const opened = await opening.run(
      `open:${current.id}`,
      {
        object_id: current.id,
        kind: 'review' as const,
        reason: reason.value,
        evidence: [],
      },
      (value, key) => api.submitTask(value, key),
    );
    if (!opened) return;
    task.value = opened;
  }
  const open = task.value;
  const decision: Decision = {
    id: '',
    object_id: current.id,
    ...(open.submission.append_id ? { append_id: open.submission.append_id } : {}),
    revision: current.revision,
    action: chosen,
    signed: signed.value,
    reason: reason.value,
    ...(chosen === 'edit' ? { body: body.value } : {}),
    ...(chosen === 'identity' ? { author_handle: current.author_handle } : {}),
    ...(chosen === 'reassign'
      ? {
          teacher_id: teacher.value,
          evidence_revision: attribution.value?.evidence_revision,
        }
      : {}),
  };
  const result = await deciding.run(
    `decide:${open.id}`,
    { revision: open.revision, decision },
    (value, key) => api.decide(open.id, value, key),
  );
  if (result) decided(result);
}

async function retryOriginal() {
  if (opening.uncertain.value) {
    const opened = await opening.retry();
    // The retried request is the original task creation.
    if (opened) task.value = opened as Task;
    return;
  }
  const result = await deciding.retry();
  if (result) decided(result as Task);
}

function decided(result: Task) {
  task.value = result;
  baseline.value = form();
  poller.resetPolls();
  success.value = t(
    result.state === 'applied'
      ? 'page.moderation.decisionApplied'
      : 'page.moderation.decisionQueued',
  );
  emit('decided', `${t(`page.moderation.taskKind.${result.submission.kind}`)} · ${t(`page.moderation.taskState.${result.state}`)}`);
}

async function retryDelivery() {
  const open = task.value;
  if (!open) return;
  const result = await retrying.run(
    `retry:${open.id}`,
    { revision: open.revision },
    (value, key) => api.retryTask(open.id, value, key),
  );
  if (result) decided(result);
}

const poller = useTaskPoll({
  task,
  isPaused: () => busy.value || uncertain.value,
  fetchTask: (id, signal) => api.task(id, signal),
  onSettled: async (current) => {
    success.value =
      current.state === 'applied' ? t('page.moderation.decisionApplied') : '';
    await load(true);
    emit('changed');
  },
  onDenied: () => data.clear(),
});

onBeforeUnmount(() => {
  emit('pending', false, false);
});

function label(key: string) {
  return te(key) ? t(key) : (key.split('.').at(-1) ?? '');
}
defineExpose({ dirty, busy, uncertain });
</script>

<template>
  <div class="flex flex-col gap-4">
    <LoadState
      :status="data.status.value"
      :error="data.error.value"
      @retry="load(true)"
    >
      <template v-if="entry">
        <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
          <DescriptionsItem :label="t('page.moderation.contentKind')">
            {{ t(`page.moderation.kind.${entry.input.kind}`) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.moderation.target')">
            <span class="break-words">{{ targetLabel }}</span>
          </DescriptionsItem>
          <DescriptionsItem v-if="termLabel" :label="t('page.moderation.term')">
            {{ termLabel }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.common.status')">
            <Tag :color="stateColor(entry.state)">{{ label(`page.moderation.state.${entry.state}`) }}</Tag>
            <Tag v-if="entry.featured" color="green">
              {{ t('page.moderation.featured') }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.moderation.author')">
            {{
              entry.anonymous
                ? t('page.moderation.anonymous')
                : t('page.moderation.signed')
            }}
            · {{ entry.author_handle }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.common.revision')">
            {{ format.number(entry.revision) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.moderation.publishedAt')">
            {{
              entry.published_at
                ? format.dateTime(entry.published_at)
                : t('page.common.notProvided')
            }}
          </DescriptionsItem>
          <DescriptionsItem
            v-if="entry.input.kind === 'course'"
            :label="t('page.moderation.teacher')"
          >
            {{
              entry.input.teacher_id
                ? (teacherNames.get(entry.input.teacher_id) ??
                  entry.input.teacher_id)
                : t('page.moderation.noTeacher')
            }}
          </DescriptionsItem>
        </Descriptions>

        <section class="rounded border p-4">
          <h3 v-if="entry.input.title" class="mb-2 text-base font-semibold">
            {{ entry.input.title }}
          </h3>
          <p class="whitespace-pre-wrap">{{ entry.input.body }}</p>
          <section v-if="task?.submission.append_id" class="mt-4">
            <h4>{{ t('page.moderation.appendForReview') }}</h4>
            <p class="whitespace-pre-wrap">{{ entry.appends?.find(item => item.id === task?.submission.append_id)?.body }}</p>
          </section>
          <div
            v-if="entry.input.kind === 'course'"
            class="mt-3 flex flex-wrap gap-2"
          >
            <Tag v-for="(name, index) in dimensions" :key="name">
              {{ t(`page.moderation.ratings.${name}.label`) }} ·
              {{
                (entry.input.ratings[index] ?? 0) > 0
                  ? t(
                      `page.moderation.ratings.${name}.level${entry.input.ratings[index]}`,
                    )
                  : t('page.moderation.unrated')
              }}
            </Tag>
          </div>
        </section>

        <section
          v-if="task?.submission.proposed_body"
          class="rounded border p-4"
        >
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-sm font-semibold">
              {{ t('page.moderation.proposedEdit') }}
            </h4>
            <Button
              size="small"
              html-type="button"
              @click="showDiff = !showDiff"
            >
              {{
                t(
                  showDiff
                    ? 'page.moderation.showPlain'
                    : 'page.moderation.showDiff',
                )
              }}
            </Button>
          </div>
          <p v-if="showDiff" class="whitespace-pre-wrap break-words text-sm">
            <template
              v-for="(segment, index) in proposedSegments"
              :key="index"
            >
              <del
                v-if="segment.kind === 'removed'"
                class="bg-red-500/15 text-red-700 line-through dark:text-red-300"
              >{{ segment.text }}</del>
              <ins
                v-else-if="segment.kind === 'added'"
                class="bg-emerald-500/15 text-emerald-700 underline dark:text-emerald-300"
              >{{ segment.text }}</ins>
              <span v-else>{{ segment.text }}</span>
            </template>
          </p>
          <p v-else class="whitespace-pre-wrap break-words text-sm">
            {{ task.submission.proposed_body }}
          </p>
        </section>

        <Alert
          v-if="task"
          type="info"
          :message="label(`page.moderation.taskKind.${task.submission.kind}`)"
        >
          <template #description>
            <p
              v-if="task.submission.reason !== 'content_review'"
              class="whitespace-pre-wrap"
            >
              {{ task.submission.reason }}
            </p>
            <p v-for="(item, index) in task.submission.evidence" :key="index">
              {{ item }}
            </p>
            <p>
              {{ t('page.common.status') }}:
              {{ label(`page.moderation.taskState.${task.state}`) }}
            </p>
            <p v-if="task.decision">
              {{
                t('page.moderation.decisionNote', {
                  reason: task.decision.reason,
                })
              }}
            </p>
            <Button
              v-if="task.state === 'failed'"
              class="mt-2"
              size="small"
              :loading="retrying.busy.value"
              @click="retryDelivery"
            >
              {{ t('page.moderation.retryDelivery') }}
            </Button>
          </template>
        </Alert>

        <Form v-if="editable" layout="vertical" @submit.prevent="decide">
          <FormItem :label="t('page.moderation.action')" required html-for="decisionpanel-field-1">
            <Select
              id="decisionpanel-field-1"
              v-model:value="action"
              :disabled="busy || uncertain"
              :placeholder="t('page.common.choose')"
              :options="
                actions.map((value) => ({
                  value,
                  label: t(`page.moderation.actions.${value}`),
                }))
              "
            />
          </FormItem>
          <p v-if="action" class="text-muted-foreground -mt-2 mb-4 text-sm">
            {{ t(`page.moderation.actionHint.${action}`) }}
          </p>
          <template v-if="action === 'reassign'">
            <FormItem :label="t('page.moderation.teacher')" html-for="decisionpanel-field-2">
              <Select
                id="decisionpanel-field-2"
                v-model:value="teacher"
                :disabled="busy || uncertain"
                :options="[
                  { value: '', label: t('page.moderation.noTeacher') },
                  ...(data.data.value?.teachers ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]"
              />
            </FormItem>
            <Space class="mb-4" wrap>
              <Button :disabled="busy" @click="inspectAttribution">
                {{ t('page.moderation.previewAttribution') }}
              </Button>
              <span v-if="attribution">{{
                t('page.moderation.attributionResult', {
                  teachers:
                    attribution.teacher_ids
                      .map((id) => teacherNames.get(id) ?? id)
                      .join(', ') || t('page.moderation.noTeacher'),
                })
              }}</span>
              <span v-if="attributionError" class="text-destructive">{{
                t('page.moderation.attributionUnavailable')
              }}</span>
            </Space>
          </template>
          <FormItem
            v-if="action === 'edit'"
            :label="t('page.moderation.editedBody')"
            required
            html-for="decisionpanel-field-3"
          >
            <Textarea
              id="decisionpanel-field-3"
              v-model:value="body"
              :rows="8"
              :maxlength="16000"
              :disabled="busy || uncertain"
            />
          </FormItem>
          <FormItem v-if="action === 'identity'">
            <Checkbox v-model:checked="signed" :disabled="busy || uncertain">
              {{ t('page.moderation.signedIdentity') }}
            </Checkbox>
          </FormItem>
          <FormItem :label="t('page.moderation.reason')" required html-for="decisionpanel-field-4">
            <ReasonPresets
              v-model="reason"
              :presets="reasonPresets"
              :disabled="busy || uncertain"
              :max-length="2000"
            />
            <Textarea
              id="decisionpanel-field-4"
              v-model:value="reason"
              :rows="3"
              :maxlength="2000"
              :disabled="busy || uncertain"
            />
          </FormItem>
          <MutationAlert
            :busy="busy"
            :error="opening.error.value || deciding.error.value"
            :uncertain="opening.uncertain.value || deciding.uncertain.value"
            :success="success"
            @retry="retryOriginal"
          />
          <Space class="mt-4" wrap>
            <Button
              type="primary"
              html-type="submit"
              :loading="busy"
              :disabled="
                uncertain ||
                !action ||
                !reason.trim() ||
                (action === 'reassign' && !attribution)
              "
            >
              {{ t('page.moderation.applyDecision') }}
            </Button>
            <Button
              v-if="deciding.error.value === 'conflict'"
              :disabled="busy"
              @click="load(true)"
            >
              {{ t('page.common.reloadCompare') }}
            </Button>
          </Space>
        </Form>
        <MutationAlert
          v-else
          :busy="busy"
          :error="retrying.error.value"
          :uncertain="retrying.uncertain.value"
          :success="success"
          @retry="retrying.retry"
        />

        <Collapse ghost>
          <CollapsePanel
            key="history"
            :header="t('page.moderation.objectHistory')"
          >
            <LoadState
              :status="related.status.value"
              :error="related.error.value"
              :empty="(related.data.value ?? []).length === 0"
              @retry="related.reload"
            >
              <Timeline>
                <TimelineItem v-for="item in related.data.value" :key="item.id">
                  <p>
                    {{
                      label(`page.moderation.taskKind.${item.submission.kind}`)
                    }}
                    · {{ label(`page.moderation.taskState.${item.state}`) }} ·
                    {{ format.dateTime(item.updated_at) }}
                  </p>
                  <p class="text-muted-foreground text-sm">
                    {{
                      item.decision?.reason ??
                      (item.submission.reason === 'content_review'
                        ? ''
                        : item.submission.reason)
                    }}
                  </p>
                </TimelineItem>
              </Timeline>
            </LoadState>
          </CollapsePanel>
          <CollapsePanel key="versions" :header="t('page.moderation.versions')">
            <LoadState
              :status="versions.status.value"
              :error="versions.error.value"
              :empty="versions.items.value.length === 0"
              @retry="versions.reload"
            >
              <div v-if="versions.items.value.length > 0" class="mb-2 flex justify-end">
                <Button size="small" html-type="button" @click="showDiff = !showDiff">
                  {{
                    t(
                      showDiff
                        ? 'page.moderation.showPlain'
                        : 'page.moderation.showDiff',
                    )
                  }}
                </Button>
              </div>
              <article
                v-for="(version, index) in versions.items.value"
                :key="version.revision"
                class="mb-3 rounded border p-3"
              >
                <p class="text-sm font-semibold">
                  {{
                    t('page.common.revisionValue', {
                      value: format.number(version.revision),
                    })
                  }}<template v-if="version.change_origin">
                    ·
                    {{
                      label(`page.moderation.changeOrigin.${version.change_origin}`)
                    }}
                  </template>
                </p>
                <p v-if="version.input.title">{{ version.input.title }}</p>
                <p
                  v-if="showDiff && versionSegments(index, version.input.body).length > 0"
                  class="whitespace-pre-wrap break-words text-sm"
                >
                  <template
                    v-for="(segment, segIndex) in versionSegments(index, version.input.body)"
                    :key="segIndex"
                  >
                    <del
                      v-if="segment.kind === 'removed'"
                      class="bg-red-500/15 text-red-700 line-through dark:text-red-300"
                    >{{ segment.text }}</del>
                    <ins
                      v-else-if="segment.kind === 'added'"
                      class="bg-emerald-500/15 text-emerald-700 underline dark:text-emerald-300"
                    >{{ segment.text }}</ins>
                    <span v-else>{{ segment.text }}</span>
                  </template>
                </p>
                <p v-else class="whitespace-pre-wrap break-words text-sm">
                  {{ version.input.body }}
                </p>
                <p
                  v-if="version.change_reason"
                  class="text-muted-foreground text-sm"
                >
                  {{ version.change_reason }}
                </p>
              </article>
              <Space wrap>
                <Button
                  v-if="versions.next.value"
                  size="small"
                  :loading="versions.appending.value"
                  @click="() => versions.loadMore()"
                >
                  {{ t('page.moderation.olderVersions') }}
                </Button>
                <Button
                  v-if="versions.items.value.length > pageSize"
                  size="small"
                  :disabled="versions.status.value === 'loading'"
                  @click="() => versions.reload()"
                >
                  {{ t('page.moderation.latestVersions') }}
                </Button>
              </Space>
            </LoadState>
          </CollapsePanel>
        </Collapse>
      </template>
    </LoadState>
  </div>
</template>
