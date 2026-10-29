<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

import { useI18n } from '@vben/locales';

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
  <section class="resources-page">
    <header>
      <h1>{{ t(entry ? 'page.resources.edit' : 'page.resources.upload') }}</h1>
      <RouterLink to="/resources/me">
        {{ t('page.resources.mine') }}
      </RouterLink>
    </header>
    <StatusBlock :busy="busy" :error="error" @retry="state.retry" />
    <div class="resource-editor-grid">
      <form class="resource-card resource-form" @submit.prevent="save">
        <fieldset :disabled="busy || uncertain">
          <legend>{{ t('page.resources.metadata') }}</legend>
          <label class="resource-field">{{ t('page.resources.resourceTitle')
            }}<input v-model="metadata.title" required maxlength="200" /></label><label class="resource-field">{{ t('page.resources.description')
            }}<textarea
              v-model="metadata.description"
              maxlength="10000"
            ></textarea>
          </label>
          <div class="resource-grid">
            <label class="resource-field">{{ t('page.resources.category')
              }}<select
                v-model="metadata.category_id"
                required
                @change="changeCategory"
              >
                <option
                  v-for="item in categories"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ name(item.names, locale) }}
                </option>
              </select></label><FieldInput
              v-for="field in category?.fields"
              :key="field.key"
              v-model="metadata.attributes[field.key]"
              :field="field"
            /><label class="resource-field">{{ t('page.resources.tags')
              }}<input v-model="tagText" maxlength="1000" /></label><label class="resource-field">{{ t('page.resources.access')
              }}<select v-model="metadata.access">
                <option value="public">{{ t('page.resources.public') }}</option>
                <option value="restricted">
                  {{ t('page.resources.restricted') }}
                </option>
              </select></label>
          </div>
          <CatalogSelect
            v-model="metadata.associations.school_id"
            kind="school"
            :disabled="!!entry"
          /><CatalogSelect
            v-model="metadata.associations.course_id"
            kind="course"
            :school="metadata.associations.school_id"
          /><CatalogSelect
            v-model="metadata.associations.term_id"
            kind="term"
            :school="metadata.associations.school_id"
          /><CatalogSelect
            v-model="metadata.associations.offering_id"
            kind="term_course"
            :school="metadata.associations.school_id"
            :course="metadata.associations.course_id"
            :term="metadata.associations.term_id"
          /><CatalogSelect
            v-model="metadata.associations.teacher_id"
            kind="teacher"
            :school="metadata.associations.school_id"
            :course="metadata.associations.course_id"
          /><label class="resource-field">{{ t('page.resources.directorySuggestion')
            }}<input v-model="metadata.directory_id" maxlength="128" /></label><label class="resource-field">{{ t('page.resources.origin')
            }}<select v-model="metadata.origin.kind">
              <option
                v-for="kind in ['original', 'known', 'unknown']"
                :key="kind"
                :value="kind"
              >
                {{ t(`page.resources.origins.${kind}`) }}
              </option>
            </select></label><label v-if="metadata.origin.kind === 'known'" class="resource-field">{{ t('page.resources.source')
            }}<input
              v-model="metadata.origin.source"
              required
              maxlength="2000"
/></label><label class="resource-field">{{ t('page.resources.author')
            }}<input v-model="metadata.origin.author" maxlength="500" /></label><label class="resource-field">{{ t('page.resources.license')
            }}<input v-model="metadata.origin.license" maxlength="2000" /></label>
          <div v-if="metadata.origin.kind === 'original' && capabilities">
            <p>{{ t('page.resources.consentNotice') }}</p>
            <a
              :href="capabilities.terms.url"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t('page.resources.terms') }}</a><label class="resource-inline"><input v-model="consent" type="checkbox" required />{{
                t('page.resources.acceptTerms')
              }}</label>
          </div>
        </fieldset>
        <button type="submit" :disabled="busy">
          {{ t(uncertain ? 'page.resources.retry' : 'page.resources.save') }}
        </button>
        <p v-if="saved" role="status">
          {{ t('page.resources.saved') }}
        </p>
      </form>
      <aside class="resource-form">
        <section class="resource-card resource-form">
          <h2>{{ t('page.resources.file') }}</h2>
          <p v-if="capabilities">
            {{
              t('page.resources.uploadLimits', {
                size: n(capabilities.max_file_size),
                types: capabilities.allowed_types.join(', '),
              })
            }}
          </p>
          <p v-if="!profile">
            {{ t('page.resources.noUploadProfile') }}
          </p>
          <label class="resource-field">{{ t('page.resources.chooseFile')
            }}<input
              type="file"
              :accept="capabilities?.allowed_types.join(',')"
              :disabled="
                busy ||
                uncertain ||
                (!!uploadState && uploadState !== 'cancelled')
              "
              @change="chooseFile"
          /></label>
          <p v-if="entry?.proposal?.file">
            {{ entry.proposal.file.filename }}
          </p>
          <p v-if="uploadState" role="status">
            {{ t(`page.resources.uploadStates.${uploadState}`) }}
          </p>
          <p v-if="reusedFile" role="status">{{ t('page.resources.reusedFile') }}</p>
          <p v-if="dirty">
            {{ t('page.resources.saveBeforeFile') }}
          </p>
          <button
            :disabled="
              busy ||
              !selected ||
              !entry ||
              dirty ||
              !profile ||
              uploadState === 'attached'
            "
            @click="sendFile"
          >
            {{
              t(
                uploadState
                  ? 'page.resources.retry'
                  : 'page.resources.uploadFile',
              )
            }}
</button><button
            v-if="selected && uploadState !== 'attached'"
            @click="cancel"
          >
            {{ t('page.resources.cancelUpload') }}
          </button>
        </section>
        <section class="resource-card resource-form">
          <p>{{ t('page.resources.reviewNotice') }}</p>
          <p v-if="entry?.proposal" role="status">
            {{ t(`page.resources.states.${entry.proposal.state}`) }}
          </p>
          <button :disabled="busy || !canSubmit" @click="submit">
            {{ t('page.resources.submit') }}
</button><RouterLink v-if="entry" :to="`/resources/items/${entry.id}`">
            {{ t('page.resources.view') }}
          </RouterLink>
        </section>
      </aside>
    </div>
  </section>
</template>
