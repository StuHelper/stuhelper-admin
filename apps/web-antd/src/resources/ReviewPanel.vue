<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

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
    <form
      class="resource-actions"
      @submit.prevent="
        after = '';
        load();
      "
    >
      <label>{{ t('page.resources.checkStatus')
        }}<select v-model="taskState" :disabled="busy || pending">
          <option
            v-for="value in ['waiting', 'decided', 'applied', 'failed']"
            :key="value"
            :value="value"
          >
            {{ t(`page.resources.states.${value}`) }}
          </option>
        </select></label><button type="submit" :disabled="busy || pending">
        {{ t('page.resources.filter') }}
      </button>
    </form>
    <StatusBlock
      :busy="busy"
      :error="error"
      :empty="tasks.length === 0"
      @retry="state.retry"
    />
    <ul class="resource-list">
      <li v-for="task in tasks" :key="task.id" class="resource-card">
        <h3>{{ t(`page.academic.requestKinds.${task.submission.kind}`) }}</h3>
        <p>{{ t(`page.resources.states.${task.state}`) }}</p>
        <p v-if="task.submission.reason !== 'content_review'">
          {{ task.submission.reason }}
        </p>
        <button :disabled="busy || pending" @click="open(task)">
          {{ t('page.resources.view') }}
        </button>
      </li>
    </ul>
    <button
      v-if="tasks.length === 25"
      :disabled="busy || pending"
      @click="
        after = tasks.at(-1)?.id ?? '';
        load();
      "
    >
      {{ t('page.resources.more') }}
    </button>
    <section
      v-if="selected && entry && version"
      class="resource-card resource-form"
    >
      <h2>{{ version.metadata.title }}</h2>
      <p>{{ version.metadata.description }}</p>
      <p>{{ name(version.category.names, locale) }}</p>
      <p>{{ version.metadata.origin.source }}</p>
      <p>{{ version.metadata.origin.license }}</p>
      <ul>
        <li v-for="evidence in selected.submission.evidence" :key="evidence">
          {{ evidence }}
        </li>
      </ul>
      <p role="status">{{ t(`page.resources.states.${selected.state}`) }}</p>
      <p v-if="selected.decision">{{ selected.decision.reason }}</p>
      <div class="resource-actions">
        <button
          v-if="version.file"
          :disabled="busy || pending"
          @click="download"
        >
          {{ t('page.resources.download') }}
</button><button :disabled="busy || pending" @click="open(selected)">
          {{ t('page.resources.reload') }}
</button><RouterLink :to="`/resources/items/${entry.id}/edit`">
{{
          t('page.resources.edit')
        }}
</RouterLink>
      </div>
      <form
        v-if="selected.state === 'waiting' || pending"
        class="resource-form"
        @submit.prevent="decide"
      >
        <fieldset :disabled="busy || pending">
          <legend>{{ t('page.resources.reviewQueue') }}</legend>
          <label class="resource-field">{{ t('page.resources.confirm')
            }}<select v-model="action">
              <option
                v-for="item in [
                  'publish',
                  'hide',
                  'restore',
                  'delete',
                  'dismiss',
                ]"
                :key="item"
                :value="item"
              >
                {{ t(`page.resources.${item}`) }}
              </option>
            </select></label><label class="resource-field">{{ t('page.resources.reason')
            }}<textarea v-model="reason" required maxlength="2000"></textarea>
          </label>
        </fieldset>
        <button type="submit" :disabled="busy">
          {{ t(pending ? 'page.resources.retry' : 'page.resources.confirm') }}
        </button>
      </form>
      <button
        v-if="selected.state === 'failed'"
        :disabled="busy"
        @click="retry"
      >
        {{ t('page.resources.retry') }}
      </button>
    </section>
  </section>
</template>
