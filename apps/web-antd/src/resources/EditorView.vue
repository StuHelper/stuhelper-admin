<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Alert, Button, Checkbox, Input, Select, Space, Tag, Textarea } from 'ant-design-vue';

import { tagColor } from '#/console-ui';

import { snapshot } from './api';
import {
  type Category,
  type Metadata,
  name,
  query,
  type Resource,
  ResourceError,
  type Schema,
  segment,
  Upload,
} from './api';
import CatalogSelect from './CatalogSelect.vue';
import FieldInput from './FieldInput.vue';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';

import './resources.css';
const route = useRoute();
const { t, locale, n } = useI18n();
const capabilities = ref<Schema['Capabilities']>();
const categories = ref<Category[]>([]);
const consent = ref(false);
const entry = ref<Resource>();
const saved = ref(false);
const selected = ref<File>();
const tagText = ref('');
const uploadState = ref('');
const reusedFile=ref(false);
let upload: undefined | Upload;
const metadata = ref<Metadata>({
  title: '',
  description: '',
  tags: [],
  category_id: '',
  category_revision: 1,
  attributes: {},
  associations: {
    school_id: String(route.query.school_id ?? ''),
    course_id: String(route.query.course_id ?? ''),
  },
  access: 'public',
  origin: { kind: 'unknown' },
});
const state = useResources(() => {
  entry.value = undefined;
 reusedFile.value=false;
  selected.value = undefined;
  metadata.value.title = '';
  metadata.value.description = '';
});
const { busy, error, uncertain } = state;
const category = computed(() =>
  categories.value.find((x) => x.id === metadata.value.category_id),
);
const profile = computed(() =>
  capabilities.value?.upload_profiles.find(
    (x) =>
      x.school_id === metadata.value.associations.school_id &&
      x.access === metadata.value.access,
  ),
);
const canSubmit = computed(
  () =>
    !!entry.value?.proposal?.file &&
    !dirty.value &&
    !['pending', 'preparing'].includes(entry.value.proposal.state),
);
const dirty = computed(() => !saved.value);
watch(
  metadata,
  () => {
    saved.value = false;
  },
  { deep: true },
);
watch(tagText, () => {
  saved.value = false;
});
watch(consent, () => {
  saved.value = false;
});
async function load() {
  await state.run(async () => {
    capabilities.value = await state.client.json(
      '/capabilities',
      'Capabilities',
      { signal: state.signal },
    );
    categories.value = [];
    let after = '';
    for (let page = 0; page < 10; page++) {
      const result = await state.client.json(
        '/categories' + query({ limit: '100', after }),
        'CategoryPage',
        { signal: state.signal },
      );
      categories.value.push(...result.items);
      after = result.next_cursor;
      if (!after) break;
    }
    categories.value.sort((a, b) => a.order - b.order);
    if (route.params.id) {
      entry.value = await state.client.json(
        '/items/' + segment(String(route.params.id)),
        'Resource',
        { signal: state.signal },
      );
      const version = entry.value.proposal ?? entry.value.current;
      if (version) {
        metadata.value = snapshot(version.metadata);
        tagText.value = version.metadata.tags.join(', ');
        consent.value = version.metadata.origin.consent?.accepted ?? false;
      }
    }
    if (!metadata.value.category_id)
      metadata.value.category_id = categories.value[0]?.id ?? '';
  });
}
function changeCategory() {
  metadata.value.attributes = {};
  metadata.value.category_revision = category.value?.revision ?? 1;
}
async function save() {
  await state.run(async () => {
    const c = category.value;
    const cap = capabilities.value;
    if (!c || !cap) throw new ResourceError('unavailable');
    const body = snapshot(metadata.value);
    body.category_revision = c.revision;
    body.tags = tagText.value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (body.origin.kind === 'original')
      body.origin.consent = {
        accepted: consent.value,
        version: cap.terms.version,
        digest: cap.terms.digest,
      };
    else delete body.origin.consent;
    const id = entry.value?.id;
    entry.value = await state.mutation.run(
      id ? '/items/' + segment(id) : '',
      'Resource',
      { revision: entry.value?.revision ?? 0, metadata: body },
      id ? 'PUT' : 'POST',
    );
    saved.value = true;
  });
}
function chooseFile(event: Event) {
  const input = event.target;
  if (input instanceof HTMLInputElement) {
    selected.value = input.files?.[0];
    upload = undefined;
    uploadState.value = '';reusedFile.value=false;
  }
}
async function sendFile() {
  await state.run(async () => {
    const cap = capabilities.value;
    const file = selected.value;
    const purpose = profile.value?.purpose;
    if (!file || !cap || !purpose || !entry.value || dirty.value)
      throw new ResourceError('invalid_input');
    if (
      file.size > cap.max_file_size ||
      !cap.allowed_types.includes(file.type || 'application/octet-stream')
    )
      throw new ResourceError('invalid_input');
    if (!upload) upload = new Upload(state.client, file, purpose);
    const version = await upload.run();
    uploadState.value = version.state;reusedFile.value=version.reused===true;
    if (['approved', 'awaiting_approval'].includes(version.state)) {
      entry.value = await state.mutation.run(
        '/items/' + segment(entry.value.id) + '/file',
        'Resource',
        { revision: entry.value.revision, media_version_id: version.id },
      );
      uploadState.value = 'attached';
    }
  });
}
async function cancel() {
  if (!upload) return;
  try {
    const version = await upload.cancel();
    uploadState.value = version.state;
    if (version.state === 'cancelled') {
      selected.value = undefined;
      upload = undefined;
      error.value = '';
    }
  } catch {
    error.value = 'cancel_pending';
  }
}
async function submit() {
  await state.run(async () => {
    if (!entry.value) return;
    entry.value = await state.mutation.run(
      '/items/' + segment(entry.value.id) + '/submit',
      'Resource',
      { revision: entry.value.revision },
    );
  });
}
void load();
</script>
<template>
  <Page :title="t(entry ? 'page.resources.edit' : 'page.resources.upload')">
    <template #extra><RouterLink to="/resources/me">{{ t('page.resources.mine') }}</RouterLink></template>
    <section class="resources-page">
      <StatusBlock :busy="busy" :error="error" @retry="state.retry" />
      <div class="resource-editor-grid">
        <form class="resource-card resource-form" @submit.prevent="save">
          <fieldset :disabled="busy || uncertain">
            <legend>{{ t('page.resources.metadata') }}</legend>
            <label class="resource-field">{{ t('page.resources.resourceTitle') }}<Input v-model:value="metadata.title" required :maxlength="200" /></label>
            <label class="resource-field">{{ t('page.resources.description') }}<Textarea v-model:value="metadata.description" :maxlength="10000" :rows="4" /></label>
            <div class="resource-grid">
              <label class="resource-field">{{ t('page.resources.category') }}
                <Select v-model:value="metadata.category_id" :disabled="busy || uncertain" :options="categories.map((item) => ({ value: item.id, label: name(item.names, locale) }))" @change="changeCategory" />
              </label>
              <FieldInput v-for="field in category?.fields" :key="field.key" v-model="metadata.attributes[field.key]" :field="field" :disabled="busy || uncertain" />
              <label class="resource-field">{{ t('page.resources.tags') }}<Input v-model:value="tagText" :maxlength="1000" /></label>
              <label class="resource-field">{{ t('page.resources.access') }}
                <Select v-model:value="metadata.access" :disabled="busy || uncertain" :options="[{ value: 'public', label: t('page.resources.public') }, { value: 'restricted', label: t('page.resources.restricted') }]" />
              </label>
            </div>
            <CatalogSelect v-model="metadata.associations.school_id" kind="school" :disabled="!!entry || busy || uncertain" />
            <CatalogSelect v-model="metadata.associations.course_id" kind="course" :school="metadata.associations.school_id" :disabled="busy || uncertain" />
            <CatalogSelect v-model="metadata.associations.term_id" kind="term" :school="metadata.associations.school_id" :disabled="busy || uncertain" />
            <CatalogSelect v-model="metadata.associations.offering_id" kind="term_course" :school="metadata.associations.school_id" :course="metadata.associations.course_id" :term="metadata.associations.term_id" :disabled="busy || uncertain" />
            <CatalogSelect v-model="metadata.associations.teacher_id" kind="teacher" :school="metadata.associations.school_id" :course="metadata.associations.course_id" :disabled="busy || uncertain" />
            <label class="resource-field">{{ t('page.resources.directorySuggestion') }}<Input v-model:value="metadata.directory_id" :maxlength="128" /></label>
            <label class="resource-field">{{ t('page.resources.origin') }}
              <Select v-model:value="metadata.origin.kind" :disabled="busy || uncertain" :options="['original', 'known', 'unknown'].map((kind) => ({ value: kind, label: t(`page.resources.origins.${kind}`) }))" />
            </label>
            <label v-if="metadata.origin.kind === 'known'" class="resource-field">{{ t('page.resources.source') }}<Input v-model:value="metadata.origin.source" required :maxlength="2000" /></label>
            <label class="resource-field">{{ t('page.resources.author') }}<Input v-model:value="metadata.origin.author" :maxlength="500" /></label>
            <label class="resource-field">{{ t('page.resources.license') }}<Input v-model:value="metadata.origin.license" :maxlength="2000" /></label>
            <Alert v-if="metadata.origin.kind === 'original' && capabilities" type="info" :message="t('page.resources.consentNotice')">
              <template #description>
                <a :href="capabilities.terms.url" target="_blank" rel="noopener noreferrer">{{ t('page.resources.terms') }}</a>
                <div><Checkbox v-model:checked="consent">{{ t('page.resources.acceptTerms') }}</Checkbox></div>
              </template>
            </Alert>
          </fieldset>
          <Button type="primary" html-type="submit" class="justify-self-start" :loading="busy" :disabled="!metadata.category_id || (metadata.origin.kind === 'original' && !!capabilities && !consent)">{{ t(uncertain ? 'page.resources.retry' : 'page.resources.save') }}</Button>
          <Alert v-if="saved" type="success" show-icon role="status" :message="t('page.resources.saved')" />
        </form>
        <aside class="resource-form">
          <section class="resource-card resource-form">
            <h2>{{ t('page.resources.file') }}</h2>
            <p v-if="capabilities" class="resource-muted">{{ t('page.resources.uploadLimits', { size: n(capabilities.max_file_size), types: capabilities.allowed_types.join(', ') }) }}</p>
            <Alert v-if="!profile" type="warning" show-icon :message="t('page.resources.noUploadProfile')" />
            <label class="resource-field">{{ t('page.resources.chooseFile') }}
              <input class="resource-file" type="file" :accept="capabilities?.allowed_types.join(',')" :disabled="busy || uncertain || (!!uploadState && uploadState !== 'cancelled')" @change="chooseFile" />
            </label>
            <p v-if="entry?.proposal?.file">{{ entry.proposal.file.filename }}</p>
            <p v-if="uploadState" role="status"><Tag :color="uploadState === 'attached' ? 'success' : 'processing'">{{ t(`page.resources.uploadStates.${uploadState}`) }}</Tag></p>
            <p v-if="reusedFile" role="status">{{ t('page.resources.reusedFile') }}</p>
            <Alert v-if="dirty" type="info" :message="t('page.resources.saveBeforeFile')" />
            <Space wrap>
              <Button type="primary" :disabled="busy || !selected || !entry || dirty || !profile || uploadState === 'attached'" @click="sendFile">{{ t(uploadState ? 'page.resources.retry' : 'page.resources.uploadFile') }}</Button>
              <Button v-if="selected && uploadState !== 'attached'" @click="cancel">{{ t('page.resources.cancelUpload') }}</Button>
            </Space>
          </section>
          <section class="resource-card resource-form">
            <p class="resource-muted">{{ t('page.resources.reviewNotice') }}</p>
            <p v-if="entry?.proposal" role="status"><Tag :color="tagColor(entry.proposal.state)">{{ t(`page.resources.states.${entry.proposal.state}`) }}</Tag></p>
            <Space wrap>
              <Button type="primary" :disabled="busy || !canSubmit" @click="submit">{{ t('page.resources.submit') }}</Button>
              <RouterLink v-if="entry" :to="`/resources/items/${entry.id}`">{{ t('page.resources.view') }}</RouterLink>
            </Space>
          </section>
        </aside>
      </div>
    </section>
  </Page>
</template>
