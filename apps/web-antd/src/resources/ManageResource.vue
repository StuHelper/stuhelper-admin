<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import { query, type Resource, type Schema, segment } from './api';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ changed: []; pending: [value: boolean] }>();
const { t } = useI18n();
const after = ref('');
const entry = ref<Resource>();
const expires = ref('');
const grantId = ref(crypto.randomUUID());
const grants = ref<Schema['Grant'][]>([]);
const next = ref('');
const reason = ref('');
const status = ref('unlisted');
const subject = ref('');
const state = useResources(() => {
  entry.value = undefined;
  grants.value = [];
});
const { busy, error, uncertain } = state;
watch([busy, uncertain], () => emit('pending', busy.value || uncertain.value));
async function read() {
  entry.value = await state.client.json(
    '/items/' + segment(props.id),
    'Resource',
    { signal: state.signal },
  );
  const result = await state.client.json(
    '/items/' +
      segment(props.id) +
      '/grants' +
      query({ limit: '25', after: after.value }),
    'GrantPage',
    { signal: state.signal },
  );
  grants.value = result.items;
  next.value = result.next_cursor;
}
function load() {
  void state.run(read);
}
function change() {
  void state.run(async () => {
    if (!entry.value) return;
    entry.value = await state.mutation.run(
      '/items/' + segment(props.id) + '/state',
      'Resource',
      {
        revision: entry.value.revision,
        state: status.value,
        reason: reason.value,
      },
    );
    emit('changed');
  });
}
function grant(existing?: Schema['Grant']) {
  void state.run(async () => {
    await state.mutation.run(
      '/items/' +
        segment(props.id) +
        '/grants/' +
        segment(existing?.id ?? grantId.value),
      'Grant',
      {
        revision: existing?.revision ?? 0,
        subject_key: existing?.subject_key ?? subject.value,
        revoked: !!existing,
        ...(!existing && expires.value
          ? { expires_at: new Date(expires.value).toISOString() }
          : {}),
      },
      'PUT',
    );
    grantId.value = crypto.randomUUID();
    subject.value = '';
    await read();
  });
}
watch(
  () => props.id,
  () => {
    after.value = '';
    entry.value = undefined;
    load();
  },
  { immediate: true },
);
</script>
<template>
  <section class="resource-form">
    <StatusBlock :busy="busy" :error="error" @retry="state.retry" /><template
      v-if="entry"
      >
<h2>{{ (entry.proposal ?? entry.current)?.metadata.title }}</h2>
      <RouterLink :to="`/resources/items/${id}/edit`">
{{
        t('page.resources.edit')
      }}
</RouterLink>
      <form class="resource-form" @submit.prevent="change">
        <fieldset :disabled="busy || uncertain">
          <legend>{{ t('page.resources.stateChange') }}</legend>
          <label class="resource-field">{{ t('page.resources.stateChange')
            }}<select v-model="status">
              <option
                v-for="item in ['unlisted', 'blocked', 'published']"
                :key="item"
                :value="item"
              >
                {{ t(`page.resources.states.${item}`) }}
              </option>
            </select></label><label class="resource-field">{{ t('page.resources.reason')
            }}<textarea v-model="reason" required maxlength="2000"></textarea>
          </label>
        </fieldset>
        <button type="submit" :disabled="busy">
          {{ t(uncertain ? 'page.resources.retry' : 'page.resources.confirm') }}
        </button>
      </form>
      <h3>{{ t('page.resources.grants') }}</h3>
      <ul class="resource-list">
        <li v-for="item in grants" :key="item.id">
          <p>{{ item.subject_key }}</p>
          <span>{{
            t(item.revoked ? 'page.resources.revoked' : 'page.resources.active')
          }}</span><button
            v-if="!item.revoked"
            :disabled="busy || uncertain"
            @click="grant(item)"
          >
            {{ t('page.resources.revoke') }}
          </button>
        </li>
      </ul>
      <button
        v-if="next"
        :disabled="busy || uncertain"
        @click="
          after = next;
          load();
        "
      >
        {{ t('page.resources.more') }}
      </button>
      <form class="resource-form" @submit.prevent="grant()">
        <fieldset :disabled="busy || uncertain">
          <legend>{{ t('page.resources.grant') }}</legend>
          <label class="resource-field">{{ t('page.resources.subjectKey')
            }}<input v-model="subject" required maxlength="1100" /></label><label class="resource-field">{{ t('page.resources.expires')
            }}<input v-model="expires" type="datetime-local" /></label>
        </fieldset>
        <button type="submit" :disabled="busy">
          {{ t(uncertain ? 'page.resources.retry' : 'page.resources.grant') }}
        </button>
      </form>
</template>
  </section>
</template>
