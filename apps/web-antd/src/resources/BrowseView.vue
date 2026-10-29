<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

import { useI18n } from '@vben/locales';

import {
  type Category,
  name,
  query,
  type Resource,
  type Schema,
  shown,
  type Value,
} from './api';
import CatalogSelect from './CatalogSelect.vue';
import FieldInput from './FieldInput.vue';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';

import './resources.css';
const route = useRoute();
const { t, locale, n } = useI18n();
const bundle = ref<Schema['Package']>();
const capabilities = ref<Schema['Capabilities']>();
const categories = ref<Category[]>([]);
const directories = ref<Schema['Directory'][]>([]);
const items = ref<Resource[]>([]);
const after = ref('');
const category = ref('');
const course = ref(String(route.query.course_id ?? ''));
const dirAfter = ref('');
const dirNext = ref('');
const fields = ref<Record<string, undefined | Value>>({});
const next = ref('');
const parents = ref<Schema['Directory'][]>([]);
const school = ref(String(route.query.school_id ?? ''));
const selected = ref<string[]>([]);
const text = ref('');
const state = useResources(() => {
  items.value = [];
  bundle.value = undefined;
  selected.value = [];
});
const { client, mutation, busy, error, uncertain } = state;
const active = computed(() =>
  categories.value.find((x) => x.id === category.value),
);
const directory = computed(() => parents.value.at(-1));
const mine = computed(() => route.path === '/resources/me');
const groups = computed(() => {
  const rows = new Map<string, Resource[]>();
  for (const item of items.value) {
    const version = mine.value ? (item.proposal ?? item.current) : item.current;
    if (!version) continue;
    const group = active.value?.group_by;
    const label = group
      ? shown(
          version.category.fields.find((x) => x.key === group),
          version.metadata.attributes[group],
          locale.value,
        ) || t('page.resources.unknown')
      : '';
    rows.set(label, [...(rows.get(label) ?? []), item]);
  }
  return [...rows];
});
async function initialize() {
  await state.run(async () => {
    capabilities.value = await client.json('/capabilities', 'Capabilities', {
      signal: state.signal,
    });
    let cursor = '';
    categories.value = [];
    for (let page = 0; page < 10; page++) {
      const result = await client.json(
        '/categories' + query({ limit: '100', after: cursor }),
        'CategoryPage',
        { signal: state.signal },
      );
      categories.value.push(...result.items);
      cursor = result.next_cursor;
      if (!cursor) break;
    }
    categories.value.sort((a, b) => a.order - b.order);
    await read();
  });
}
async function read() {
  const page = await client.json(
    (mine.value ? '/me' : '') +
      query({
        school_id: school.value,
        course_id: course.value,
        category_id: category.value,
        query: text.value,
        attributes: JSON.stringify(fields.value),
        after: after.value,
        directory_id: directory.value?.id,
        limit: '25',
      }),
    'ResourcePage',
    { signal: state.signal },
  );
  items.value = page.items;
  next.value = page.next_cursor;
  selected.value = [];
  if (school.value) {
    const dirs = await client.json(
      '/directories' +
        query({
          school_id: school.value,
          course_id: course.value,
          parent_id: directory.value?.id,
          after: dirAfter.value,
          limit: '25',
        }),
      'DirectoryPage',
      { signal: state.signal },
    );
    directories.value = dirs.items;
    dirNext.value = dirs.next_cursor;
  } else {
    directories.value = [];
    dirNext.value = '';
  }
}
function filter() {
  after.value = '';
  bundle.value = undefined;
  void state.run(read);
}
function changeDirectory(value?: Schema['Directory']) {
  if (value) parents.value.push(value);
  else parents.value.pop();
  after.value = '';
  dirAfter.value = '';
  void state.run(read);
}
function pack(all = false) {
  void state.run(async () => {
    bundle.value = await mutation.run(
      '/packages',
      'Package',
      all
        ? { directory_id: directory.value?.id }
        : { resource_ids: selected.value },
    );
  });
}
function downloadPart(index: number) {
  const b = bundle.value;
  const c = capabilities.value;
  if (!b || !c) return;
  void state.run(() =>
    client.download(
      `/packages/${b.id}/parts/${index}`,
      `resources-${index}.zip`,
      c.max_package_bytes,
      state.signal,
    ),
  );
}
watch(category, () => {
  fields.value = {};
});
watch(school, () => {
  course.value = '';
  parents.value = [];
});
watch(course, () => {
  parents.value = [];
});
watch(
  () => route.path,
  () => {
    after.value = '';
    void initialize();
  },
  { immediate: true },
);
</script>
<template>
  <section class="resources-page">
    <header>
      <h1>{{ t(mine ? 'page.resources.mine' : 'page.resources.title') }}</h1>
      <nav class="resource-actions">
        <RouterLink to="/resources">
          {{ t('page.resources.title') }}
</RouterLink><RouterLink to="/resources/me">
          {{ t('page.resources.mine') }}
</RouterLink><RouterLink to="/resources/requests">
          {{ t('page.resources.myRequests') }}
</RouterLink><RouterLink to="/resources/new">
          {{ t('page.resources.upload') }}
        </RouterLink>
      </nav>
    </header>
    <form class="resource-card resource-form" @submit.prevent="filter">
      <div class="resource-grid">
        <CatalogSelect
          v-model="school"
          kind="school"
          :disabled="busy || uncertain"
        /><CatalogSelect
          v-model="course"
          kind="course"
          :school="school"
          :disabled="busy || uncertain"
        /><label class="resource-field">{{ t('page.resources.category')
          }}<select v-model="category" :disabled="busy || uncertain">
            <option value="">{{ t('page.resources.all') }}</option>
            <option v-for="item in categories" :key="item.id" :value="item.id">
              {{ name(item.names, locale) }}
            </option>
          </select></label><label class="resource-field">{{ t('page.resources.search')
          }}<input
            v-model="text"
            type="search"
            maxlength="200"
            :disabled="busy || uncertain"
/></label><FieldInput
          v-for="field in active?.fields.filter((x) => x.filterable)"
          :key="field.key"
          v-model="fields[field.key]"
          :field="field"
          filter
          :disabled="busy || uncertain"
        />
      </div>
      <button type="submit" :disabled="busy || uncertain">
        {{ t('page.resources.filter') }}
      </button>
    </form>
    <StatusBlock
      :busy="busy"
      :error="error"
      :empty="items.length === 0 && directories.length === 0"
      @retry="state.retry"
    />
    <section v-if="school" class="resource-card">
      <h2>{{ t('page.resources.directories') }}</h2>
      <div class="resource-actions">
        <button
          v-if="directory"
          :disabled="busy || uncertain"
          @click="changeDirectory()"
        >
          {{ t('page.resources.parent') }}
</button><span>{{
          directory ? name(directory.names, locale) : t('page.resources.root')
        }}</span><button
          v-for="item in directories"
          :key="item.id"
          :disabled="busy || uncertain"
          @click="changeDirectory(item)"
        >
          {{ name(item.names, locale) }}
</button><button
          v-if="dirNext"
          :disabled="busy || uncertain"
          @click="
            dirAfter = dirNext;
            state.run(read);
          "
        >
          {{ t('page.resources.more') }}
</button><button v-if="directory" :disabled="busy" @click="pack(true)">
          {{
            t(
              uncertain
                ? 'page.resources.retry'
                : 'page.resources.downloadDirectory',
            )
          }}
        </button>
      </div>
    </section>
    <p v-if="active?.group_by" class="resource-muted">
      {{ t('page.resources.pageGroups') }}
    </p>
    <section v-for="[label, rows] in groups" :key="label">
      <h2 v-if="label">
        {{ label }}
      </h2>
      <ul class="resource-list">
        <li v-for="item in rows" :key="item.id" class="resource-card">
          <div class="resource-actions">
            <input
              v-if="item.download_allowed"
              v-model="selected"
              type="checkbox"
              :value="item.id"
              :aria-label="`${t('page.resources.select')} ${item.current?.metadata.title ?? ''}`"
              :disabled="busy || uncertain"
            /><RouterLink :to="`/resources/items/${item.id}`">
              {{
                (mine ? (item.proposal ?? item.current) : item.current)
                  ?.metadata.title
              }}
</RouterLink><span class="resource-state">{{
              t(
                `page.resources.states.${mine ? (item.proposal?.state ?? item.state) : item.state}`,
              )
            }}</span>
          </div>
          <p>
            {{
              (mine ? (item.proposal ?? item.current) : item.current)?.metadata
                .description
            }}
          </p>
          <div class="resource-meta">
            <span>{{
              name(
                (item.proposal ?? item.current)?.category.names ?? {},
                locale,
              )
            }}</span><span v-if="item.current?.file">{{ n(item.current.file.size) }}
              {{ t('page.resources.bytes') }}</span>
          </div>
        </li>
      </ul>
    </section>
    <div class="resource-actions">
      <button
        v-if="selected.length > 0 || uncertain"
        :disabled="busy"
        @click="pack()"
      >
        {{
          t(
            uncertain
              ? 'page.resources.retry'
              : 'page.resources.downloadSelected',
          )
        }}
</button><button
        v-if="next"
        :disabled="busy || uncertain"
        @click="
          after = next;
          state.run(read);
        "
      >
        {{ t('page.resources.more') }}
      </button>
    </div>
    <section v-if="bundle" class="resource-card">
      <h2>{{ t('page.resources.packages') }}</h2>
      <p>
        {{
          t('page.resources.packageInstructions', {
            count: bundle.parts.length,
          })
        }}
      </p>
      <ul>
        <li v-for="part in bundle.parts" :key="part.number">
          <button :disabled="busy" @click="downloadPart(part.number)">
            {{ t('page.resources.part', { number: n(part.number) }) }}
</button><span>{{ n(part.bytes) }} {{ t('page.resources.bytes') }}</span>
          <ul>
            <li v-for="entry in part.files" :key="entry.version_id">
              {{ entry.filename }}
            </li>
          </ul>
        </li>
      </ul>
    </section>
  </section>
</template>
