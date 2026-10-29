<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { name, query, type Schema, segment } from './api';
import CatalogSelect from './CatalogSelect.vue';
import NamesInput from './NamesInput.vue';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';
const props = defineProps<{ school: string }>();
const emit = defineEmits<{ pending: [value: boolean] }>();
const { t, locale } = useI18n();
const after = ref('');
const editing = ref(false);
const form = ref<Schema['DirectoryWrite']>();
const id = ref('');
const next = ref('');
const parents = ref<Schema['Directory'][]>([]);
const rows = ref<Schema['Directory'][]>([]);
const parent = computed(() => parents.value.at(-1));
const state = useResources(() => {
  rows.value = [];
  form.value = undefined;
});
const { busy, error, uncertain } = state;
watch([busy, uncertain], () => emit('pending', busy.value || uncertain.value));
function load() {
  void state.run(async () => {
    const result = await state.client.json(
      '/directories' +
        query({
          school_id: props.school,
          parent_id: parent.value?.id,
          after: after.value,
          limit: '25',
        }),
      'DirectoryPage',
      { signal: state.signal },
    );
    rows.value = result.items;
    next.value = result.next_cursor;
  });
}
function open(row?: Schema['Directory']) {
  editing.value = !!row;
  id.value = row?.id ?? crypto.randomUUID();
  form.value = row
    ? {
        revision: row.revision,
        names: { ...row.names },
        school_id: row.school_id,
        course_id: row.course_id,
        parent_id: row.parent_id,
        enabled: row.enabled,
      }
    : {
        revision: 0,
        names: {},
        school_id: props.school,
        course_id: parent.value?.course_id,
        parent_id: parent.value?.id,
        enabled: true,
      };
}
function enter(row?: Schema['Directory']) {
  if (row) parents.value.push(row);
  else parents.value.pop();
  after.value = '';
  form.value = undefined;
  load();
}
function save() {
  void state.run(async () => {
    if (!form.value) return;
    const result = await state.mutation.run(
      '/directories/' + segment(id.value),
      'Directory',
      form.value,
      'PUT',
    );
    form.value.revision = result.revision;
    editing.value = true;
    const page = await state.client.json(
      '/directories' +
        query({
          school_id: props.school,
          parent_id: parent.value?.id,
          limit: '25',
        }),
      'DirectoryPage',
    );
    rows.value = page.items;
    next.value = page.next_cursor;
  });
}
watch(
  () => props.school,
  () => {
    rows.value = [];
    parents.value = [];
    form.value = undefined;
    after.value = '';
    load();
  },
  { immediate: true },
);
</script>
<template>
  <section class="resource-form">
    <StatusBlock :busy="busy" :error="error" @retry="state.retry" />
    <div class="resource-actions">
      <button v-if="parent" :disabled="busy || uncertain" @click="enter()">
        {{ t('page.resources.parent') }}
      </button>
      <h2>
        {{ parent ? name(parent.names, locale) : t('page.resources.root') }}
      </h2>
      <button :disabled="busy || uncertain" @click="open()">
        {{ t('page.resources.newDirectory') }}
      </button>
    </div>
    <ul class="resource-list">
      <li v-for="row in rows" :key="row.id">
        <span>{{ name(row.names, locale) }}</span><button :disabled="busy || uncertain" @click="enter(row)">
          {{ t('page.resources.directories') }}
</button><button :disabled="busy || uncertain" @click="open(row)">
          {{ t('page.resources.edit') }}
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
    <form v-if="form" class="resource-form" @submit.prevent="save">
      <fieldset :disabled="busy || uncertain">
        <legend>{{ t('page.resources.directories') }}</legend>
        <label class="resource-field">{{ t('page.resources.identifier')
          }}<input
            v-model="id"
            required
            maxlength="128"
            :readonly="editing"
/></label><NamesInput v-model="form.names" /><CatalogSelect
          v-model="form.course_id"
          kind="course"
          :school="school"
          :disabled="editing"
        /><label class="resource-field">{{ t('page.resources.parent')
          }}<input v-model="form.parent_id" maxlength="128" /></label><label class="resource-inline"><input v-model="form.enabled" type="checkbox" />{{
            t('page.resources.enabled')
          }}</label>
      </fieldset>
      <button type="submit" :disabled="busy">
        {{ t(uncertain ? 'page.resources.retry' : 'page.resources.save') }}
      </button>
    </form>
  </section>
</template>
