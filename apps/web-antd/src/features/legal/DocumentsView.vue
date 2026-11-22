<script setup lang="ts">
import type { AdminDocumentMetadata } from './api';

import { computed, nextTick, onMounted, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Tag } from 'ant-design-vue';

import { useAsync } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';

import { useLegalApi } from './api';
import { loadDocumentPage } from './document-page';
import DocumentEditor from './DocumentEditor.vue';

const { t } = useI18n();
const api = useLegalApi();
const errorText = useErrorText();
const format = useFormat();
const denied = ref('');
const notice = ref(false);
const editor = shallowRef<'new' | Pick<AdminDocumentMetadata, 'slug' | 'version'>>();
const listRegion = ref<HTMLElement>();
const offsets = ref([0]);
const offset = computed(() => offsets.value.at(-1) ?? 0);
const listing = useAsync((signal) => loadDocumentPage(api, offset.value, signal), {
  onDenied: (error) => deny(error.status === 401 ? 'unauthenticated' : 'forbidden'),
});
const caption = (key: string, values?: Record<string, string>) =>
  t(`page.legal.documents.${key}`, values ?? {});
const colors = { archived: 'default', draft: 'gold', published: 'green' };

function deny(code: string) {
  denied.value = code;
  editor.value = undefined;
  notice.value = false;
  listing.clear();
}

function open(selection?: AdminDocumentMetadata) {
  notice.value = false;
  editor.value = selection ? { slug: selection.slug, version: selection.version } : 'new';
}

function next() {
  const nextOffset = listing.data.value?.next_offset;
  if (nextOffset === undefined || nextOffset <= offset.value) return;
  offsets.value.push(nextOffset);
  void listing.reload();
}

function previous() {
  if (offsets.value.length < 2) return;
  offsets.value.pop();
  void listing.reload();
}

async function close(deleted: boolean) {
  editor.value = undefined;
  notice.value = deleted;
  void nextTick(() => listRegion.value?.focus());
  await listing.reload();
  if (deleted && listing.data.value?.items.length === 0) previous();
}

onMounted(listing.reload);
</script>

<template>
  <AdminPage :title="caption('title')">
    <template v-if="!editor && listing.status.value === 'ready' && !denied" #extra>
      <Button type="primary" @click="open()">{{ caption('newDraft') }}</Button>
    </template>

    <Alert v-if="denied" type="error" show-icon role="alert" :message="errorText(denied)" />
    <DocumentEditor
      v-else-if="editor"
      :selection="editor === 'new' ? undefined : editor"
      @close="close"
      @denied="deny"
    />

    <div
      v-else
      ref="listRegion"
      class="flex min-w-0 flex-col gap-4"
      :aria-label="caption('title')"
      role="region"
      tabindex="-1"
    >
      <Alert v-if="notice" type="success" show-icon role="status" :message="caption('deletedNotice')" />
      <Card :bordered="false">
        <LoadState
          :status="listing.status.value"
          :error="listing.error.value"
          :empty="!listing.data.value?.items.length"
          @retry="listing.reload"
        >
          <table aria-labelledby="legal-document-list-caption" class="legal-document-table" role="table">
            <caption id="legal-document-list-caption" class="sr-only">{{ caption('title') }}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">{{ caption('documentTitle') }}</th>
                <th scope="col" role="columnheader">{{ caption('version') }}</th>
                <th scope="col" role="columnheader">{{ caption('currentVersion') }}</th>
                <th scope="col" role="columnheader">{{ t('page.common.operation') }}</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              <tr v-for="row in listing.data.value?.items" :key="`${row.slug}/${row.version}`" role="row">
                <td role="cell">
                  <div class="font-semibold" dir="auto">{{ row.title }}</div>
                  <bdi class="mt-1 block font-mono text-xs">{{ row.slug }}</bdi>
                </td>
                <td role="cell">
                  <bdi class="font-mono">{{ row.version }}</bdi>
                  <Tag class="ms-2" :color="colors[row.status]">{{ caption(row.status) }}</Tag>
                  <div v-if="row.effective_date" class="mt-1">
                    {{ caption('effectiveDate') }} <bdi>{{ format.calendarDate(row.effective_date) }}</bdi>
                  </div>
                </td>
                <td role="cell">
                  <span class="legal-mobile-label">{{ caption('currentVersion') }}</span>
                  <bdi v-if="listing.data.value?.current[row.slug]" class="font-mono">
                    {{ listing.data.value.current[row.slug] }}
                  </bdi>
                  <span v-else-if="listing.data.value?.current[row.slug] === null">{{ caption('notPublished') }}</span>
                  <span v-else>{{ caption('currentVersionUnavailable') }}</span>
                </td>
                <td role="cell">
                  <Button class="legal-open-button" @click="open(row)">{{ caption('openVersion', { version: row.version }) }}</Button>
                </td>
              </tr>
            </tbody>
          </table>
        </LoadState>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button v-if="offset > 0" :disabled="listing.status.value === 'loading'" @click="previous">
            {{ caption('previous') }}
          </Button>
          <Button v-if="listing.data.value?.next_offset !== undefined" @click="next">{{ t('page.common.next') }}</Button>
          <Button v-if="listing.status.value === 'ready'" @click="listing.reload">{{ t('page.common.refresh') }}</Button>
        </div>
      </Card>
    </div>
  </AdminPage>
</template>

<style scoped>
.legal-document-table {
  width: 100%;
  text-align: start;
}

.legal-document-table td,
.legal-document-table th {
  padding: 0.75rem;
  text-align: start;
  vertical-align: top;
  overflow-wrap: anywhere;
  border-block-end: 1px solid hsl(var(--border));
}

.legal-open-button {
  max-inline-size: 100%;
  block-size: auto;
  min-block-size: 32px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.legal-mobile-label {
  display: none;
}

@media (max-width: 767px) {
  .legal-document-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .legal-document-table,
  .legal-document-table tbody,
  .legal-document-table tr,
  .legal-document-table td {
    display: block;
  }

  .legal-document-table tr {
    padding-block: 0.5rem;
    border-block-end: 1px solid hsl(var(--border));
  }

  .legal-document-table td {
    padding: 0.375rem 0;
    border: 0;
  }

  .legal-mobile-label {
    display: block;
    margin-block-end: 0.25rem;
    font-weight: 500;
  }
}
</style>
