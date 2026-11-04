<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { stateTone } from '#/console-ui';

import { type Category, name, query, type Resource } from './api';
import CatalogSelect from './CatalogSelect.vue';
import CategoryEditor from './CategoryEditor.vue';
import DirectoriesPanel from './DirectoriesPanel.vue';
import ManageResource from './ManageResource.vue';
import ReviewPanel from './ReviewPanel.vue';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';

import './resources.css';
const { t, locale } = useI18n();
const after = ref('');
const categories = ref<Category[]>([]);
const category = ref<Category>();
const childBusy = ref(false);
const course = ref('');
const editing = ref(false);
const next = ref('');
const rows = ref<Resource[]>([]);
const school = ref('');
const selected = ref('');
const tab = ref('content');
const state = useResources(() => {
  rows.value = [];
  selected.value = '';
  categories.value = [];
});
const { busy, error } = state;
async function read() {
  if (tab.value === 'taxonomy') {
    const page = await state.client.json(
      '/categories' +
        query({ include_disabled: 'true', after: after.value, limit: '100' }),
      'CategoryPage',
      { signal: state.signal },
    );
    categories.value = page.items.toSorted((a, b) => a.order - b.order);
    next.value = page.next_cursor;
  } else if (tab.value === 'content' && school.value) {
    const page = await state.client.json(
      '/manage' +
        query({
          school_id: school.value,
          course_id: course.value,
          after: after.value,
          limit: '25',
        }),
      'ResourcePage',
      { signal: state.signal },
    );
    rows.value = page.items;
    next.value = page.next_cursor;
  } else {
    rows.value = [];
    next.value = '';
  }
}
function load() {
  void state.run(read);
}
watch(
  [tab, school],
  () => {
    after.value = '';
    next.value = '';
    selected.value = '';
    editing.value = false;
    load();
  },
  { immediate: true },
);
</script>
<template>
  <Page :title="t('page.resources.adminTitle')">
<section class="resources-page">
      <nav class="admin-tabs">
        <button
          v-for="item in ['content', 'taxonomy', 'directories', 'reviewQueue']"
          :key="item"
          class="admin-tab"
          :aria-pressed="tab === item"
          :disabled="busy || childBusy"
          @click="tab = item"
        >
          {{ t(`page.resources.${item}`) }}
</button><RouterLink class="admin-tab-end" to="/resources/new">
{{
          t('page.resources.upload')
        }}
</RouterLink>
      </nav>
      <div v-if="tab !== 'taxonomy'" class="resource-card resource-grid">
        <CatalogSelect
          v-model="school"
          kind="school"
          :disabled="childBusy || busy"
        /><CatalogSelect
          v-if="tab === 'content'"
          v-model="course"
          kind="course"
          :school="school"
          :disabled="childBusy || busy"
        /><button
          v-if="tab === 'content'"
          :disabled="childBusy || busy || !school"
          @click="
            after = '';
            load();
          "
        >
          {{ t('page.resources.filter') }}
        </button>
      </div>
      <StatusBlock :busy="busy" :error="error" @retry="state.retry" />
      <p v-if="tab !== 'taxonomy' && !school" class="resource-muted">{{ t('page.academic.selectSchool') }}</p>
      <section v-if="tab === 'taxonomy'" class="resource-form">
        <button
          class="is-primary"
          style="justify-self: start"
          :disabled="childBusy || busy"
          @click="
            category = undefined;
            editing = true;
          "
        >
          {{ t('page.resources.newCategory') }}
        </button>
        <div class="resource-columns">
        <ul class="resource-list">
          <li v-for="row in categories" :key="row.id" class="resource-card console-row-head" :class="{ 'is-selected': editing && category?.id === row.id }">
            <span>{{ name(row.names, locale) }}</span><button
              :disabled="childBusy || busy"
              @click="
                category = row;
                editing = true;
              "
            >
              {{ t('page.resources.edit') }}
            </button>
          </li>
        </ul>
        <CategoryEditor
          v-if="editing"
          :key="category?.id ?? 'new'"
          :category="category"
          @pending="childBusy = $event"
          @saved="load"
        />
        <div v-else class="console-placeholder">{{ t('page.console.selectItem') }}</div>
        </div>
      </section>
      <section v-else-if="tab === 'content'" class="resource-columns">
        <ul class="resource-list">
          <li v-for="row in rows" :key="row.id" class="resource-card" :class="{ 'is-selected': selected === row.id }">
            <div class="console-row-head"><h2>{{ (row.proposal ?? row.current)?.metadata.title }}</h2><span class="console-badge" :data-tone="stateTone(row.state)">{{ t(`page.resources.states.${row.state}`) }}</span></div>
            <button
              class="mt-2" :disabled="busy || childBusy" @click="selected = row.id"
>
              {{ t('page.resources.view') }}
            </button>
          </li>
        </ul>
        <ManageResource
          v-if="selected"
          :key="selected"
          :id="selected"
          class="resource-card console-detail"
          @pending="childBusy = $event"
          @changed="load"
        />
        <div v-else-if="rows.length > 0" class="console-placeholder">{{ t('page.console.selectItem') }}</div>
      </section>
      <DirectoriesPanel
        v-else-if="tab === 'directories' && school"
        :key="school"
        :school="school"
        @pending="childBusy = $event"
      /><ReviewPanel
        v-else-if="tab === 'reviewQueue' && school"
        :key="school"
        :school="school"
        @pending="childBusy = $event"
      /><button
        v-if="next"
        :disabled="busy || childBusy"
        @click="
          after = next;
          load();
        "
      >
        {{ t('page.resources.more') }}
      </button>
    </section>
</Page>
</template>
