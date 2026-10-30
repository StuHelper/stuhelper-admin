<script setup lang="ts">
import type { AttributionPreview, Decision, Task } from './api';

import {
  computed,
  onBeforeUnmount,
  onMounted,
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
import { useAsync, useMutation } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { dimensions, pageSize, useAcademicAdmin } from './api';

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
const historyBefore = ref('');
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
  const teachers =
    entry.input.kind === 'course'
      ? await api.options(
          {
            kind: 'teacher',
            course_id: entry.input.target_id,
            school_id: entry.school_id,
          },
          signal,
        )
      : [];
  return { entry, task: record, teachers };
});
const entry = computed(() => data.data.value?.entry);
const related = useAsync(async (signal) =>
  entry.value
    ? api.tasks(
        { school_id: props.schoolId, object_id: entry.value.id, limit: 100 },
        signal,
      )
    : [],
);
const versions = useAsync(async (signal) =>
  entry.value
    ? api.history(
        entry.value.id,
        { before: historyBefore.value, limit: pageSize },
        signal,
      )
    : [],
);

async function load(preserve = false) {
  await data.reload();
  const result = data.data.value;
  if (!result) return;
  task.value = result.task;
  historyBefore.value = '';
  void related.reload();
  void versions.reload();
  if (preserve) return;
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
  const values: Decision['action'][] = [];
  if (current.state === 'pending') values.push('publish');
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
  polls = 0;
  success.value = t(
    result.state === 'applied'
      ? 'page.moderation.decisionApplied'
      : 'page.moderation.decisionQueued',
  );
  emit('changed');
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

// Follow a saved decision until the content module reports the result.
let polls = 0;
let polling = false;
let timer: ReturnType<typeof setInterval> | undefined;
const stop = new AbortController();
async function poll() {
  const open = task.value;
  if (
    polling ||
    busy.value ||
    uncertain.value ||
    open?.state !== 'decided' ||
    polls >= 20
  )
    return;
  polling = true;
  polls++;
  try {
    const current = await api.task(open.id, stop.signal);
    task.value = current;
    if (current.state !== 'decided') {
      success.value =
        current.state === 'applied' ? t('page.moderation.decisionApplied') : '';
      await load(true);
      emit('changed');
    }
  } catch (error) {
    polls = 20;
    if (error instanceof ApiError && error.denied) data.clear();
  } finally {
    polling = false;
  }
}
onMounted(() => {
  timer = setInterval(() => void poll(), 3000);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  stop.abort();
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
{{
            t(`page.moderation.kind.${entry.input.kind}`)
          }}
</DescriptionsItem>
          <DescriptionsItem :label="t('page.common.status')">
            <Tag>{{ label(`page.moderation.state.${entry.state}`) }}</Tag>
            <Tag v-if="entry.featured" color="green">
{{
              t('page.moderation.featured')
            }}
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
{{
            format.number(entry.revision)
          }}
</DescriptionsItem>
          <DescriptionsItem :label="t('page.moderation.publishedAt')">
{{
            entry.published_at ? format.dateTime(entry.published_at) : t('page.common.notProvided')
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
{{
                t('page.moderation.previewAttribution')
              }}
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
{{
              t('page.moderation.signedIdentity')
            }}
</Checkbox>
          </FormItem>
          <FormItem :label="t('page.moderation.reason')" required html-for="decisionpanel-field-4">
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
              :empty="(versions.data.value ?? []).length === 0"
              @retry="versions.reload"
            >
              <article
                v-for="version in versions.data.value"
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
                <p class="whitespace-pre-wrap text-sm">
                  {{ version.input.body }}
                </p>
                <p
                  v-if="version.change_reason"
                  class="text-muted-foreground text-sm"
                >
                  {{ version.change_reason }}
                </p>
              </article>
              <Button
                v-if="(versions.data.value?.length ?? 0) === pageSize"
                size="small"
                @click="
                  historyBefore = String(
                    versions.data.value?.at(-1)?.revision ?? 0,
                  );
                  versions.reload();
                "
                >
{{ t('page.moderation.olderVersions') }}
</Button>
            </LoadState>
          </CollapsePanel>
        </Collapse>
      </template>
    </LoadState>
  </div>
</template>
