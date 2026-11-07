<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Button, Descriptions, DescriptionsItem, Select, Space, Tag, Textarea } from 'ant-design-vue';

import { tagColor } from '#/console-ui';

import {
  name,
  query,
  type Resource,
  ReviewMutation,
  segment,
  type Task,
} from './api';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';
const props = defineProps<{ school: string }>();
const emit = defineEmits<{ pending: [value: boolean] }>();
const { t, locale } = useI18n();
const action = ref('publish');
const after = ref('');
const entry = ref<Resource>();
const pending = ref(false);
const reason = ref('');
const selected = ref<Task>();
const tasks = ref<Task[]>([]);
const taskState = ref('waiting');
const state = useResources(() => {
  tasks.value = [];
  selected.value = undefined;
  entry.value = undefined;
});
const { busy, error } = state;
const mutation = new ReviewMutation(state.client);
const retryMutation = new ReviewMutation(state.client);
watch([busy, pending], () => emit('pending', busy.value || pending.value));
const version = computed(() =>
  entry.value?.proposal?.id === selected.value?.submission.object_id.slice(9)
    ? entry.value?.proposal
    : entry.value?.current,
);
async function read() {
  tasks.value = await state.client.tasks(
    '/tasks' +
      query({
        admin: 'true',
        school_id: props.school,
        content_kind: 'resource',
        state: taskState.value,
        limit: '25',
        after: after.value,
      }),
    state.signal,
  );
}
function load() {
  void state.run(read);
}
function open(task: Task) {
  void state.run(async () => {
    selected.value = await state.client.task('/tasks/' + segment(task.id), {
      signal: state.signal,
    });
    entry.value = await state.client.json(
      '/review/' + segment(selected.value.submission.object_id.slice(9)),
      'Resource',
      { signal: state.signal },
    );
    reason.value = '';
    action.value = entry.value.proposal ? 'publish' : 'hide';
  });
}
async function decide() {
  await state.run(async () => {
    if (!entry.value || !selected.value) return;
    try {
      selected.value = await mutation.run(
        '/tasks/' + segment(selected.value.id) + '/decisions',
        {
          revision: selected.value.revision,
          decision: {
            id: '',
            object_id: selected.value.submission.object_id,
            revision: entry.value.revision,
            action: action.value,
            signed: false,
            reason: reason.value,
          },
        },
      );
      await read();
    } finally {
      pending.value = mutation.uncertain || retryMutation.uncertain;
    }
  });
}
async function retry() {
  await state.run(async () => {
    if (!selected.value) return;
    try {
      selected.value = await retryMutation.run(
        '/tasks/' + segment(selected.value.id) + '/retry',
        { revision: selected.value.revision },
      );
      await read();
    } finally {
      pending.value = mutation.uncertain || retryMutation.uncertain;
    }
  });
}
function download() {
  const file = version.value?.file;
  const id = version.value?.id;
  if (file && id)
    void state.run(() =>
      state.client.download(
        '/review/' + segment(id) + '/file',
        file.filename,
        file.size,
        state.signal,
      ),
    );
}
watch(
  () => props.school,
  () => {
    after.value = '';
    selected.value = undefined;
    entry.value = undefined;
    load();
  },
  { immediate: true },
);
</script>
<template>
  <section class="resource-form">
    <form class="console-controls" @submit.prevent="after = ''; load();">
      <label class="resource-field">{{ t('page.resources.checkStatus') }}
        <Select v-model:value="taskState" class="min-w-40" :disabled="busy || pending" :options="['waiting', 'decided', 'applied', 'failed'].map((value) => ({ value, label: t(`page.resources.states.${value}`) }))" />
      </label>
      <Button html-type="submit" class="self-end" :disabled="busy || pending">{{ t('page.resources.filter') }}</Button>
    </form>
    <StatusBlock :busy="busy" :error="error" :empty="tasks.length === 0" @retry="state.retry" />
    <div class="resource-columns">
      <ul class="resource-list">
        <li v-for="task in tasks" :key="task.id" class="resource-card" :class="{ 'is-selected': selected?.id === task.id }">
          <div class="console-row-head">
            <h3>{{ t(`page.academic.requestKinds.${task.submission.kind}`) }}</h3>
            <Tag :color="tagColor(task.state)">{{ t(`page.resources.states.${task.state}`) }}</Tag>
          </div>
          <p v-if="task.submission.reason !== 'content_review'">{{ task.submission.reason }}</p>
          <Button type="link" size="small" :disabled="busy || pending" @click="open(task)">{{ t('page.resources.view') }}</Button>
        </li>
      </ul>
      <section v-if="selected && entry && version" class="resource-card resource-form console-detail">
        <h2>{{ version.metadata.title }}</h2>
        <p>{{ version.metadata.description }}</p>
        <Descriptions :column="1" size="small">
          <DescriptionsItem :label="t('page.resources.category')">{{ name(version.category.names, locale) }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.resources.source')">{{ version.metadata.origin.source }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.resources.license')">{{ version.metadata.origin.license }}</DescriptionsItem>
        </Descriptions>
        <ul>
          <li v-for="evidence in selected.submission.evidence" :key="evidence">{{ evidence }}</li>
        </ul>
        <p role="status"><Tag :color="tagColor(selected.state)">{{ t(`page.resources.states.${selected.state}`) }}</Tag></p>
        <p v-if="selected.decision">{{ selected.decision.reason }}</p>
        <Space wrap>
          <Button v-if="version.file" :disabled="busy || pending" @click="download">{{ t('page.resources.download') }}</Button>
          <Button :disabled="busy || pending" @click="open(selected)">{{ t('page.resources.reload') }}</Button>
          <RouterLink :to="`/resources/items/${entry.id}/edit`">{{ t('page.resources.edit') }}</RouterLink>
        </Space>
        <form v-if="selected.state === 'waiting' || pending" class="resource-form" @submit.prevent="decide">
          <fieldset :disabled="busy || pending">
            <legend>{{ t('page.resources.reviewQueue') }}</legend>
            <label class="resource-field">{{ t('page.resources.confirm') }}
              <Select v-model:value="action" :disabled="busy || pending" :options="['publish', 'hide', 'restore', 'delete', 'dismiss'].map((item) => ({ value: item, label: t(`page.resources.${item}`) }))" />
            </label>
            <label class="resource-field">{{ t('page.resources.reason') }}<Textarea v-model:value="reason" required :maxlength="2000" /></label>
          </fieldset>
          <Button type="primary" html-type="submit" class="justify-self-start" :loading="busy">{{ t(pending ? 'page.resources.retry' : 'page.resources.confirm') }}</Button>
        </form>
        <Button v-if="selected.state === 'failed'" class="justify-self-start" :disabled="busy" @click="retry">{{ t('page.resources.retry') }}</Button>
      </section>
    </div>
    <Button v-if="tasks.length === 25" class="justify-self-start" :disabled="busy || pending" @click="after = tasks.at(-1)?.id ?? ''; load();">{{ t('page.resources.more') }}</Button>
  </section>
</template>
