<script setup lang="ts">
import type { AdminDocument, DraftContent, ValidationIssue } from './api';

import { computed, onMounted, onScopeDispose, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Form,
  FormItem,
  Input,
  Modal,
  Tag,
} from 'ant-design-vue';

import { ApiError } from '#/shared/api/errors';
import { useAsync, useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useLegalApi, validationIssues } from './api';
import DocumentPreview from './DocumentPreview.vue';
import DocumentValidation from './DocumentValidation.vue';
import DraftMarkdownInput from './DraftMarkdownInput.vue';

type Selection = Pick<AdminDocument, 'slug' | 'version'>;
type Draft = { date: string; markdown: string; title: string };
type Dialog = 'archive' | 'delete' | 'preview' | 'publish';
type WriteResult =
  | { document: AdminDocument; kind: 'archive' | 'create' | 'publish' | 'save' }
  | { kind: 'delete' };

const props = defineProps<{ selection?: Selection }>();
const emit = defineEmits<{ close: [deleted: boolean]; denied: [code: string] }>();
const { t } = useI18n();
const api = useLegalApi();
const format = useFormat();
const errorText = useErrorText();
const heading = ref<HTMLElement>();
const target = shallowRef(props.selection);
const stored = shallowRef<AdminDocument>();
const form = ref<Draft>(draftOf());
const baseline = shallowRef<Draft>(draftOf());
const slug = ref('');
const version = ref('');
const copied = ref('');
const dialog = ref<Dialog>();
const conflictPending = ref(false);
const compared = ref(false);
const missing = ref(false);
const invalidFields = ref(false);
const checkingPublication = ref(false);
const publicationChanged = ref(false);
const writeIssues = shallowRef<ValidationIssue[]>([]);
const previewIssues = shallowRef<ValidationIssue[]>([]);
const success = ref('');
let active = true;

const detail = useAsync((signal) => {
  if (!target.value) throw new ApiError('invalid_input');
  return api.getVersion(target.value.slug, target.value.version, signal);
}, { onDenied: deny });
const preview = useAsync(async (signal) => {
  const server = stored.value;
  if (!server) throw new ApiError('invalid_input');
  try {
    const body = dialog.value === 'preview' && canEdit.value ? content() : undefined;
    return await api.previewVersion(server.slug, server.version, body, signal);
  } catch (error) {
    if (!signal.aborted) previewIssues.value = validationIssues(error);
    throw error;
  }
}, { onDenied: deny });
const write = useMutation({ onDenied: deny });

const caption = (key: string, values?: Record<string, string>) =>
  t(`page.legal.documents.${key}`, values ?? {});
const canEdit = computed(() => !missing.value && (!target.value || stored.value?.status === 'draft'));
const dirty = computed(() => {
  const { date, markdown, title } = form.value;
  return (
    date !== baseline.value.date ||
    title !== baseline.value.title ||
    markdown !== baseline.value.markdown ||
    (!target.value && (!!version.value || (!!slug.value && !copied.value)))
  );
});
const locked = computed(() => write.busy.value || write.uncertain.value);
const busy = computed(() => locked.value || checkingPublication.value || detail.status.value === 'loading');
const retained = computed(() => !canEdit.value && dirty.value);
const colors = { archived: 'default', draft: 'gold', published: 'green' };
const title = computed(() =>
  target.value
    ? caption('openVersion', { version: target.value.version })
    : caption(copied.value ? 'copyDraft' : 'newDraft'),
);

onScopeDispose(() => {
  active = false;
});
onMounted(() => {
  heading.value?.focus();
  if (target.value) void loadVersion();
});
useLeaveGuard(() => {
  if (write.uncertain.value) return t('page.common.leaveUncertain');
  return dirty.value || write.busy.value ? t('page.common.leaveUnsaved') : '';
});

function draftOf(value?: AdminDocument): Draft {
  return {
    date: value?.effective_date ?? '',
    markdown: value?.markdown ?? '',
    title: value?.title ?? '',
  };
}

function adopt(document: AdminDocument, keepEdits = false) {
  stored.value = document;
  target.value = { slug: document.slug, version: document.version };
  baseline.value = draftOf(document);
  if (!keepEdits) form.value = { ...baseline.value };
  missing.value = false;
  conflictPending.value = false;
}

function content(): DraftContent {
  return {
    effective_date: form.value.date || null,
    markdown: form.value.markdown,
    title: form.value.title,
  };
}

function deny(error: ApiError) {
  active = false;
  stored.value = undefined;
  target.value = undefined;
  form.value = draftOf();
  baseline.value = draftOf();
  slug.value = '';
  version.value = '';
  copied.value = '';
  cancelDialog();
  writeIssues.value = [];
  emit('denied', error.status === 401 ? 'unauthenticated' : 'forbidden');
}

function back() {
  if (busy.value || (dirty.value && !window.confirm(t('page.common.leaveUnsaved')))) return;
  emit('close', false);
}

async function loadVersion(compare = false) {
  await detail.reload();
  if (!active) return;
  const current = detail.data.value;
  if (current) {
    adopt(current, compare && dirty.value);
    compared.value = compare;
    write.dismiss();
    return;
  }
  if (compare && detail.error.value === 'not_found') {
    stored.value = undefined;
    missing.value = true;
    conflictPending.value = false;
    write.dismiss();
  }
}

function copyDraft(useRetained = false) {
  if (!target.value || busy.value || (!stored.value && !useRetained)) return;
  const source = useRetained ? { ...form.value } : { ...draftOf(stored.value), date: '' };
  slug.value = target.value.slug;
  copied.value = target.value.version;
  version.value = '';
  target.value = undefined;
  stored.value = undefined;
  baseline.value = useRetained ? draftOf() : { ...source };
  form.value = source;
  missing.value = false;
  compared.value = false;
  invalidFields.value = false;
  writeIssues.value = [];
  success.value = '';
  write.dismiss();
  heading.value?.focus();
}

function discardDraft() {
  if (!compared.value && dirty.value && !window.confirm(t('page.common.leaveUnsaved'))) return;
  form.value = { ...baseline.value };
  compared.value = false;
  invalidFields.value = false;
  writeIssues.value = [];
  success.value = '';
  write.dismiss();
}

function validateFields() {
  const bytes = new TextEncoder();
  const { date, markdown, title: draftTitle } = form.value;
  const validContent =
    draftTitle.trim() && !/[\r\n]/.test(draftTitle) && !draftTitle.includes('\0') && bytes.encode(draftTitle).length <= 256 &&
    markdown.trim() && !markdown.includes('\0') && bytes.encode(markdown).length <= 131_072 &&
    (!date || (/^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith('0000-')));
  const validTarget = target.value || (
    slug.value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug.value) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version.value)
  );
  invalidFields.value = !validTarget || !validContent;
  return !invalidFields.value;
}

async function observeWrite<T extends WriteResult>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    writeIssues.value = validationIssues(error);
    throw error;
  }
}

async function applyOutcome(result: undefined | WriteResult) {
  if (!active || write.uncertain.value) return;
  if (result?.kind === 'delete') {
    emit('close', true);
    return;
  }
  if (result) {
    adopt(result.document);
    compared.value = false;
    success.value = result.kind === 'publish'
      ? caption('publishedNotice')
      : (result.kind === 'archive'
        ? caption('archivedNotice')
        : t('page.common.saved'));
    return;
  }
  if (target.value && ['conflict', 'invalid_status', 'not_found'].includes(write.error.value)) {
    conflictPending.value = true;
    await loadVersion(true);
  }
}

async function save() {
  if (busy.value || conflictPending.value || !canEdit.value || !validateFields()) return;
  const server = stored.value;
  const source = slug.value;
  success.value = '';
  writeIssues.value = [];
  const result = server
    ? await write.run('save-draft', content(), (body, key) =>
        observeWrite(api.updateDraft(server.slug, server.version, server.revision, body, key)
          .then((document) => ({ kind: 'save' as const, document }))),
      )
    : await write.run('create-draft', { ...content(), version: version.value }, (body, key) =>
        observeWrite(api.createDraft(source, body, key)
          .then((document) => ({ kind: 'create' as const, document }))),
      );
  await applyOutcome(result);
}

async function retryWrite() {
  if (!write.uncertain.value || write.busy.value) return;
  writeIssues.value = [];
  // This mutation instance only runs senders that return WriteResult.
  await applyOutcome(await write.retry() as undefined | WriteResult);
}

function showDialog(kind: Dialog) {
  if (busy.value || conflictPending.value || !stored.value) return;
  if (kind === 'preview' && canEdit.value && !validateFields()) return;
  if (kind === 'publish') {
    if (dirty.value) return;
    if (!stored.value.effective_date) {
      write.dismiss();
      success.value = '';
      writeIssues.value = [{ code: 'required', key: 'effective_date' }];
      return;
    }
  }
  dialog.value = kind;
  if (kind === 'preview' || kind === 'publish') void loadPreview();
}

function loadPreview() {
  previewIssues.value = [];
  return preview.reload();
}

function cancelDialog() {
  publicationChanged.value = false;
  dialog.value = undefined;
  previewIssues.value = [];
  preview.clear();
}

function dismissDialog() {
  if (!checkingPublication.value) cancelDialog();
}

async function verifyPublicationPreview() {
  const digest = preview.data.value?.digest;
  if (!digest) return false;
  checkingPublication.value = true;
  try {
    await loadPreview();
    const renewed = preview.data.value;
    if (!active || !renewed || dialog.value !== 'publish') return false;
    publicationChanged.value = renewed.digest !== digest;
    return !publicationChanged.value;
  } finally {
    checkingPublication.value = false;
  }
}

async function confirmWrite() {
  const server = stored.value;
  const kind = dialog.value;
  if (busy.value || conflictPending.value || !server || !kind || kind === 'preview') return;
  if (kind === 'publish' && (dirty.value || preview.status.value !== 'ready' || !(await verifyPublicationPreview()))) return;
  cancelDialog();
  success.value = '';
  writeIssues.value = [];
  const result = await write.run(kind, server.revision, async (revision, key) => {
    const { slug: keySlug, version: keyVersion } = server;
    if (kind === 'delete') {
      return observeWrite(api.deleteDraft(keySlug, keyVersion, revision, key)
        .then(() => ({ kind })));
    }
    const request = kind === 'publish'
      ? api.publishVersion(keySlug, keyVersion, revision, key)
      : api.archiveVersion(keySlug, keyVersion, revision, key);
    return observeWrite(request.then((document) => ({ kind, document })));
  });
  await applyOutcome(result);
}

const dialogTitle = computed(() => {
  if (!dialog.value) return '';
  return caption(`${dialog.value}Title`, { version: target.value?.version ?? '' });
});
const writeError = computed(() => {
  if (writeIssues.value.length > 0 || write.error.value === 'already_exists' || conflictPending.value) return '';
  return write.error.value;
});
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <div>
      <Button :disabled="busy" @click="back">{{ caption('back') }}</Button>
    </div>
    <Card :bordered="false">
      <header class="mb-4">
        <h2 ref="heading" class="text-lg font-semibold" tabindex="-1">{{ title }}</h2>
        <div v-if="target" class="mt-1 flex flex-wrap items-center gap-2">
          <bdi class="break-all font-mono">{{ target.slug }}</bdi>
          <Tag v-if="stored" :color="colors[stored.status]">{{ caption(stored.status) }}</Tag>
          <span v-if="stored">{{ t('page.common.revisionValue', { value: format.number(stored.revision) }) }}</span>
        </div>
        <p v-if="copied && !target" class="mt-1">{{ caption('copySource', { version: copied }) }}</p>
      </header>

      <LoadState
        v-if="target && !stored && !missing"
        :status="detail.status.value"
        :error="detail.error.value"
        @retry="loadVersion()"
      />

      <div v-else class="flex min-w-0 flex-col gap-4">
        <Alert v-if="missing" type="warning" show-icon role="alert" :message="retained ? caption('versionUnavailable') : errorText('not_found')" />
        <Alert v-else-if="retained" type="warning" show-icon role="alert" :message="caption('editClosed')" />

        <LoadState
          v-if="conflictPending"
          :status="detail.status.value"
          :error="detail.error.value"
          @retry="loadVersion(true)"
        />
        <Alert
          v-if="compared && !conflictPending && stored"
          type="warning"
          show-icon
          role="status"
          :message="canEdit && dirty ? t('page.common.compareNotice') : caption('serverDraft')"
        >
          <template v-if="canEdit && dirty" #description>
            <details class="mt-2" open>
              <summary class="cursor-pointer">{{ caption('serverDraft') }}</summary>
              <dl class="my-2 flex flex-col gap-1">
                <dt class="font-medium">{{ caption('documentTitle') }}</dt>
                <dd dir="auto">{{ stored.title }}</dd>
                <dt class="font-medium">{{ caption('effectiveDate') }}</dt>
                <dd>{{ stored.effective_date ? format.calendarDate(stored.effective_date) : t('page.common.notProvided') }}</dd>
                <dt class="font-medium">{{ caption('markdown') }}</dt>
                <dd><pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono" dir="auto" tabindex="0">{{ stored.markdown }}</pre></dd>
              </dl>
              <Button :disabled="busy" @click="discardDraft">{{ caption('discardConflict') }}</Button>
            </details>
          </template>
        </Alert>

        <Alert
          v-if="stored?.changed_variables.length"
          type="info"
          show-icon
          :message="caption('changedVariables')"
        >
          <template #description>
            <p>{{ caption('changedVariablesHint') }}</p>
            <ul class="mt-2 flex flex-wrap gap-2">
              <li v-for="key in stored.changed_variables" :key="key">
                <bdi class="break-all rounded border px-2 py-1 font-mono">{{ key }}</bdi>
              </li>
            </ul>
          </template>
        </Alert>

        <MutationAlert
          :busy="write.busy.value"
          :error="writeError"
          :success="success"
          :uncertain="write.uncertain.value"
          @retry="retryWrite"
        />
        <DocumentValidation v-if="writeIssues.length > 0" :issues="writeIssues" />
        <Alert v-if="write.error.value === 'already_exists'" type="error" show-icon role="alert" :message="caption('alreadyExists')" />
        <Alert v-if="invalidFields" type="error" show-icon role="alert" :message="caption('fieldValidation')" />

        <Form v-if="canEdit" layout="vertical" novalidate @submit.prevent="save">
          <fieldset class="min-w-0" :disabled="busy || conflictPending">
            <div v-if="!target" class="grid gap-x-4 sm:grid-cols-2">
              <FormItem :label="caption('slug')" html-for="legal-document-slug" required>
                <Input id="legal-document-slug" v-model:value="slug" dir="ltr" :maxlength="64" :readonly="!!copied" required />
              </FormItem>
              <FormItem :label="caption('version')" html-for="legal-document-version" required>
                <Input id="legal-document-version" v-model:value="version" dir="ltr" :maxlength="64" required />
              </FormItem>
            </div>
            <div class="grid gap-x-4 sm:grid-cols-[2fr_1fr]">
              <FormItem :label="caption('documentTitle')" html-for="legal-document-title" required>
                <Input id="legal-document-title" v-model:value="form.title" dir="auto" :maxlength="256" required />
              </FormItem>
              <FormItem :label="caption('effectiveDate')" html-for="legal-document-date" :extra="caption('dateHint')">
                <input
                  id="legal-document-date"
                  v-model="form.date"
                  class="ant-input w-full"
                  dir="ltr"
                  type="date"
                  min="0001-01-01"
                  max="9999-12-31"
                />
              </FormItem>
            </div>
            <FormItem :label="caption('markdown')" html-for="legal-document-markdown" required>
              <DraftMarkdownInput
                v-model="form.markdown"
                :locked="busy || conflictPending"
                @denied="deny"
              />
            </FormItem>
            <div class="flex flex-wrap gap-2">
              <Button type="primary" html-type="submit" :disabled="!!target && !dirty">{{ caption('saveDraft') }}</Button>
              <template v-if="stored">
                <Button @click="showDialog('preview')">{{ caption('preview') }}</Button>
                <Button v-if="dirty && !compared" @click="discardDraft">{{ t('page.common.discard') }}</Button>
                <Button :disabled="dirty" @click="showDialog('publish')">{{ caption('publish') }}</Button>
                <Button danger :disabled="dirty" @click="showDialog('delete')">{{ caption('deleteDraft') }}</Button>
              </template>
            </div>
            <p v-if="stored && dirty" class="mt-2 text-sm">{{ caption('saveBeforePublish') }}</p>
          </fieldset>
        </Form>

        <template v-if="stored && !canEdit">
          <dl class="flex flex-col gap-1">
            <dt class="font-medium">{{ caption('documentTitle') }}</dt>
            <dd dir="auto">{{ stored.title }}</dd>
            <dt class="font-medium">{{ caption('effectiveDate') }}</dt>
            <dd>{{ stored.effective_date ? format.calendarDate(stored.effective_date) : t('page.common.notProvided') }}</dd>
            <dt class="font-medium">{{ caption('markdown') }}</dt>
            <dd><pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border p-3 font-mono" dir="auto" tabindex="0">{{ stored.markdown }}</pre></dd>
          </dl>
          <div class="flex flex-wrap gap-2">
            <Button :disabled="busy" @click="showDialog('preview')">{{ caption('preview') }}</Button>
            <Button v-if="!retained" :disabled="busy" @click="copyDraft()">{{ caption('copyDraft') }}</Button>
            <Button v-if="stored.status === 'published'" danger :disabled="busy || retained" @click="showDialog('archive')">{{ caption('archive') }}</Button>
          </div>
        </template>
        <section v-if="retained" class="flex flex-col gap-2">
          <h3 class="font-medium">{{ caption('retainedDraft') }}</h3>
          <div dir="auto">{{ form.title }}</div>
          <div v-if="form.date">{{ format.calendarDate(form.date) }}</div>
          <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border p-3 font-mono" dir="auto" tabindex="0">{{ form.markdown }}</pre>
          <div><Button :disabled="busy" @click="copyDraft(true)">{{ caption('copyDraft') }}</Button></div>
        </section>
      </div>
    </Card>

    <Modal
      :open="!!dialog"
      :title="dialogTitle"
      :width="800"
      :closable="!checkingPublication"
      :keyboard="!checkingPublication"
      :mask-closable="false"
      @cancel="dismissDialog"
    >
      <template v-if="dialog === 'preview' || dialog === 'publish'">
        <p v-if="dialog === 'publish' && stored?.effective_date" class="mb-4">
          {{ caption('publishHint', { date: format.calendarDate(stored.effective_date) }) }}
        </p>
        <Alert
          v-if="publicationChanged"
          class="mb-4"
          type="warning"
          show-icon
          role="alert"
          :message="caption('publicationChanged')"
        />
        <DocumentValidation v-if="previewIssues.length > 0" :issues="previewIssues" />
        <LoadState v-else :status="preview.status.value" :error="preview.error.value" @retry="loadPreview">
          <DocumentPreview v-if="preview.data.value" :html="preview.data.value.html" :digest="preview.data.value.digest" />
        </LoadState>
      </template>
      <p v-else-if="dialog">{{ caption(`${dialog}Hint`) }}</p>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <Button :disabled="checkingPublication" @click="dismissDialog">{{ t('page.common.cancel') }}</Button>
          <Button
            v-if="dialog && dialog !== 'preview'"
            type="primary"
            :danger="dialog === 'archive' || dialog === 'delete'"
            :disabled="dialog === 'publish' && preview.status.value !== 'ready'"
            :loading="checkingPublication"
            @click="confirmWrite"
          >
{{ dialog === 'publish' ? caption('confirmPublish') : t('page.common.confirm') }}
</Button>
        </div>
      </template>
    </Modal>
  </div>
</template>
