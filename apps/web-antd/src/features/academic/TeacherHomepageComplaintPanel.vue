<script setup lang="ts">
import type { Decision, Task } from './api';
import type { ViolationCategory } from './violationCategories';

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  Form,
  FormItem,
  Select,
  Tag,
} from 'ant-design-vue';

import { ApiError } from '#/shared/api/errors';
import { useAsync, useMutation } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import LoadState from '#/shared/ui/LoadState.vue';
import { isValidModerationReason } from '#/shared/ui/moderation-reason';
import ModerationReasonField from '#/shared/ui/ModerationReasonField.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';
import { stateColor } from '#/shared/ui/state-color';

import { useAcademicAdmin } from './api';
import { useTaskPoll } from './useTaskPoll';
import { violationCategories } from './violationCategories';

const props = defineProps<{ schoolId: string; taskId: string }>();
const emit = defineEmits<{
  changed: [];
  decided: [message: string];
  pending: [busy: boolean, dirty: boolean, uncertain: boolean];
}>();

const { t } = useI18n();
const format = useFormat();
const api = useAcademicAdmin();
const task = shallowRef<Task>();
const action = ref<'dismiss' | 'hide'>();
const reason = ref('');
const category = ref<ViolationCategory>();
const initialCategory = ref<ViolationCategory>();
const pollDenied = ref(false);

const data = useAsync(async (signal) => {
  const record = await api.task(props.taskId, signal);
  if (record.school_id !== props.schoolId) throw new ApiError('forbidden');

  const objectId = record.submission.object_id;
  const teacherId = /^teacher-homepage:([\w.:-]{1,128})$/.exec(objectId)?.[1];
  if (record.content_kind !== 'teacher_homepage' || !teacherId)
    throw new ApiError('incompatible');

  try {
    const target = await api.teacherComplaintTarget(teacherId, signal);
    if (target.school_id !== props.schoolId) throw new ApiError('forbidden');
    if (target.object_id !== objectId) throw new ApiError('incompatible');
    return { record, target, teacherId };
  } catch (error) {
    // A removed or merged directory record can still have an open complaint.
    if (error instanceof ApiError && error.status === 404)
      return { record, target: undefined, teacherId };
    throw error;
  }
}, {
  onDenied: () => { task.value = undefined; },
});
const mutation = useMutation({ onDenied: clear });
const needsReload = computed(() => ['conflict', 'not_found'].includes(mutation.error.value));
const target = computed(() => data.data.value?.target);
const dirty = computed(
  () => !!action.value || !!reason.value || category.value !== initialCategory.value,
);
const locked = computed(() => mutation.busy.value || mutation.uncertain.value);
const canDecide = computed(
  () =>
    task.value?.state === 'waiting' ||
    (task.value?.state === 'failed' &&
      ['conflict', 'forbidden'].includes(task.value.error_code ?? '')),
);
const canRetryDelivery = computed(
  () => task.value?.state === 'failed' && task.value.error_code === 'unavailable',
);
const categoryOptions = computed(() =>
  violationCategories.map((value) => ({ value, label: t(`page.moderation.categories.${value}`) })),
);
const reasonPresets = computed(() =>
  ['privacy', 'unsubstantiated'].map((key) => ({ key, text: t(`page.moderation.presets.${key}`) })),
);
const actions = computed(() =>
  (target.value ? (['hide', 'dismiss'] as const) : (['dismiss'] as const)).map(
    (value) => ({ value, label: t(`page.teacherHomepage.moderation.${value}`) }),
  ),
);

function clear() {
  data.clear();
  task.value = undefined;
}
function resetForm(record: Task) {
  initialCategory.value = record.decision?.category ?? record.submission.category;
  category.value = initialCategory.value;
  action.value = undefined;
  reason.value = '';
}
async function load() {
  pollDenied.value = false;
  await data.reload();
  const loaded = data.data.value;
  if (!loaded) return;
  task.value = loaded.record;
  if (!dirty.value || !canDecide.value) resetForm(loaded.record);
  if (!loaded.target && action.value === 'hide') action.value = undefined;
  mutation.dismiss();
}
void load();

watch(
  [locked, dirty, mutation.uncertain],
  () => emit('pending', locked.value, dirty.value, mutation.uncertain.value),
  { immediate: true },
);
onBeforeUnmount(() => emit('pending', false, false, false));

const poller = useTaskPoll({
  task,
  isPaused: () => locked.value || data.status.value === 'loading',
  fetchTask: (id, signal) => api.task(id, signal),
  onSettled: async () => {
    await load();
    emit('changed');
  },
  onDenied: () => {
    clear();
    pollDenied.value = true;
  },
});

async function decide() {
  const current = task.value;
  const chosen = action.value;
  if (
    !current ||
    !canDecide.value ||
    locked.value ||
    !chosen ||
    !isValidModerationReason(reason.value) ||
    needsReload.value
  ) return;
  if (chosen === 'hide' && !target.value) return;

  const decision: Decision = {
    id: '',
    object_id: current.submission.object_id,
    revision: target.value?.revision ?? current.object_revision,
    action: chosen,
    reason: reason.value,
    ...(category.value ? { category: category.value } : {}),
  };
  const result = await mutation.run(
    `decide:${current.id}`,
    { revision: current.revision, decision },
    (body, key) => api.decide(current.id, body, key),
  );
  if (result) decided(result);
}

async function retryDelivery() {
  const current = task.value;
  if (!current || !canRetryDelivery.value || locked.value || needsReload.value) return;
  const result = await mutation.run(
    `retry:${current.id}`,
    { revision: current.revision },
    (body, key) => api.retryTask(current.id, body, key),
  );
  if (result) decided(result);
}

async function retryOriginal() {
  const result = await mutation.retry();
  // Both retries return the updated moderation task through the same validator.
  if (result) decided(result as Task);
}

function decided(result: Task) {
  task.value = result;
  resetForm(result);
  poller.resetPolls();
  if (result.state === 'applied' && result.decision?.action === 'hide') void load();
  emit('decided', `${t('page.teacherHomepage.moderation.kind')} · ${t(`page.moderation.taskState.${result.state}`)}`);
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <LoadState :status="data.status.value" :error="data.error.value" @retry="load">
      <template v-if="data.data.value && task">
        <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
          <DescriptionsItem :label="t('page.moderation.contentKind')">
            {{ t('page.teacherHomepage.moderation.kind') }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherHomepage.moderation.target')">
            <bdi class="break-all">{{ data.data.value.teacherId }}</bdi>
          </DescriptionsItem>
          <DescriptionsItem v-if="target" :label="t('page.teacherHomepage.moderation.targetVisibility')">
            {{ t(target.visible ? 'page.teacherHomepage.moderation.visible' : 'page.teacherHomepage.moderation.notVisible') }}
          </DescriptionsItem>
          <DescriptionsItem v-if="target" :label="t('page.common.revision')">
            {{ format.number(target.revision) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.common.status')">
            <Tag :color="stateColor(task.state)">{{ t(`page.moderation.taskState.${task.state}`) }}</Tag>
          </DescriptionsItem>
        </Descriptions>
        <Alert
          v-if="!target"
          type="warning"
          show-icon
          :message="t('page.teacherHomepage.moderation.missing')"
        />
        <Alert type="info" :message="t('page.moderation.taskKind.report')">
          <template #description>
            <p v-if="task.submission.category">
              {{ t(`page.moderation.categories.${task.submission.category}`) }}
            </p>
            <p class="whitespace-pre-wrap break-words">{{ task.submission.reason }}</p>
            <p v-for="(item, index) in task.submission.evidence" :key="index" class="whitespace-pre-wrap break-words">
              {{ item }}
            </p>
          </template>
        </Alert>
        <p v-if="task.decision" class="break-words">
          {{ t(`page.teacherHomepage.moderation.${task.decision.action}`) }} ·
          {{ t('page.moderation.decisionNote', { reason: task.decision.reason }) }}
        </p>
        <Form v-if="canDecide" layout="vertical" @submit.prevent="decide">
          <FormItem
            :label="t('page.moderation.action')"
            html-for="teacher-homepage-complaint-action"
            required
          >
            <Select
              id="teacher-homepage-complaint-action"
              v-model:value="action"
              :disabled="locked"
              :options="actions"
              :placeholder="t('page.common.choose')"
            />
          </FormItem>
          <p v-if="action" class="text-muted-foreground -mt-2 mb-4 text-sm">
            {{ t(action === 'hide' ? 'page.teacherHomepage.moderation.hideHint' : 'page.moderation.actionHint.dismiss') }}
          </p>
          <FormItem :label="t('page.moderation.category')" html-for="teacher-homepage-complaint-category">
            <Select
              id="teacher-homepage-complaint-category"
              v-model:value="category"
              show-search
              option-filter-prop="label"
              allow-clear
              :disabled="locked"
              :options="categoryOptions"
              :placeholder="t('page.moderation.uncategorized')"
            />
          </FormItem>
          <ModerationReasonField
            id="teacher-homepage-complaint-reason"
            v-model="reason"
            :label="t('page.moderation.reason')"
            :presets="reasonPresets"
            :disabled="locked"
          />
          <Button
            type="primary"
            html-type="submit"
            :loading="mutation.busy.value"
            :disabled="locked || !action || !isValidModerationReason(reason) || needsReload"
          >
            {{ t('page.moderation.applyDecision') }}
          </Button>
        </Form>
        <Button
          v-if="canRetryDelivery"
          :disabled="locked || needsReload"
          @click="retryDelivery"
        >
          {{ t('page.moderation.retryDelivery') }}
        </Button>
      </template>
    </LoadState>
    <MutationAlert
      :busy="mutation.busy.value"
      :error="pollDenied ? 'forbidden' : mutation.error.value"
      :uncertain="mutation.uncertain.value"
      @retry="retryOriginal"
    />
    <div v-if="needsReload">
      <Button :disabled="locked || data.status.value === 'loading'" @click="load">
        {{ t('page.common.reloadCompare') }}
      </Button>
    </div>
  </div>
</template>
