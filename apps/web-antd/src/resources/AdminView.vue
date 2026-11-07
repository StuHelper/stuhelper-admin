<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Alert, Button, Empty, TabPane, Tabs, Tag } from 'ant-design-vue';

import { tagColor } from '#/console-ui';

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
      <Tabs :active-key="tab" @change="tab = String($event)">
        <TabPane v-for="item in ['content', 'taxonomy', 'directories', 'reviewQueue']" :key="item" :tab="t(`page.resources.${item}`)" :disabled="(busy || childBusy) && tab !== item" />
        <template #rightExtra><RouterLink to="/resources/new">{{ t('page.resources.upload') }}</RouterLink></template>
      </Tabs>
      <div v-if="tab !== 'taxonomy'" class="resource-card resource-grid">
        <CatalogSelect v-model="school" kind="school" :disabled="childBusy || busy" />
        <CatalogSelect v-if="tab === 'content'" v-model="course" kind="course" :school="school" :disabled="childBusy || busy" />
        <Button v-if="tab === 'content'" type="primary" :disabled="childBusy || busy || !school" @click="after = ''; load();">{{ t('page.resources.filter') }}</Button>
      </div>
      <StatusBlock :busy="busy" :error="error" @retry="state.retry" />
      <Alert v-if="tab !== 'taxonomy' && !school" type="info" show-icon :message="t('page.academic.selectSchool')" />
      <section v-if="tab === 'taxonomy'" class="resource-form">
        <Button type="primary" class="justify-self-start" :disabled="childBusy || busy" @click="category = undefined; editing = true;">{{ t('page.resources.newCategory') }}</Button>
        <div class="resource-columns">
          <ul class="resource-list">
            <li v-for="row in categories" :key="row.id" class="resource-card console-row-head" :class="{ 'is-selected': editing && category?.id === row.id }">
              <span>{{ name(row.names, locale) }}</span>
              <Button type="link" size="small" :disabled="childBusy || busy" @click="category = row; editing = true;">{{ t('page.resources.edit') }}</Button>
            </li>
          </ul>
          <CategoryEditor v-if="editing" :key="category?.id ?? 'new'" :category="category" @pending="childBusy = $event" @saved="load" />
          <Empty v-else class="console-placeholder" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.console.selectItem')" />
        </div>
      </section>
      <section v-else-if="tab === 'content'" class="resource-columns">
        <ul class="resource-list">
          <li v-for="row in rows" :key="row.id" class="resource-card" :class="{ 'is-selected': selected === row.id }">
            <div class="console-row-head"><h2>{{ (row.proposal ?? row.current)?.metadata.title }}</h2><Tag :color="tagColor(row.state)">{{ t(`page.resources.states.${row.state}`) }}</Tag></div>
            <Button type="link" size="small" :disabled="busy || childBusy" @click="selected = row.id">{{ t('page.resources.view') }}</Button>
          </li>
        </ul>
        <ManageResource v-if="selected" :id="selected" :key="selected" class="resource-card console-detail" @pending="childBusy = $event" @changed="load" />
        <Empty v-else-if="rows.length > 0" class="console-placeholder" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.console.selectItem')" />
      </section>
      <DirectoriesPanel v-else-if="tab === 'directories' && school" :key="school" :school="school" @pending="childBusy = $event" />
      <ReviewPanel v-else-if="tab === 'reviewQueue' && school" :key="school" :school="school" @pending="childBusy = $event" />
      <Button v-if="next" class="justify-self-start" :disabled="busy || childBusy" @click="after = next; load();">{{ t('page.resources.more') }}</Button>
    </section>
  </Page>
</template>
