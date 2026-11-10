<script setup lang="ts">
import type { CatalogImport, ImportPreview, ImportResult } from './api';

import { computed, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Form,
  FormItem,
  Space,
  Table,
  Tag,
} from 'ant-design-vue';

import { ApiError, errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { parseCatalogImport, useAcademicAdmin } from './api';
import { useCampusId } from './campus';
import CampusPending from './CampusPending.vue';

/**
 * Normalized catalog import: read a file in the browser, preview the changes
 * (new, updated, conflicting and unlinked records), then confirm with the
 * preview token. A failed import never clears existing records.
 */
const { t, te } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useAcademicAdmin();
const confirm = useMutation();
const school = useCampusId();
const input = shallowRef<CatalogImport>();
const preview = shallowRef<ImportPreview>();
const result = shallowRef<ImportResult>();
const error = ref('');
const previewing = ref(false);
const fileInput = ref<HTMLInputElement>();
let generation = 0;
const locked = computed(
  () => previewing.value || confirm.busy.value || confirm.uncertain.value,
);

watch(school, () => {
  generation++;
  input.value = undefined;
  preview.value = undefined;
  error.value = '';
});
useLeaveGuard(() => (locked.value ? t('page.common.leaveUncertain') : ''));

async function choose(event: Event) {
  const file =
    event.target instanceof HTMLInputElement
      ? event.target.files?.[0]
      : undefined;
  const current = ++generation;
  error.value = '';
  preview.value = undefined;
  input.value = undefined;
  result.value = undefined;
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw new ApiError('capacity_exceeded');
    const value = parseCatalogImport(await file.text());
    if (current !== generation) return;
    // An import may only target the school selected on this page.
    if (value.school_id !== school.value) throw new ApiError('school_mismatch');
    input.value = value;
  } catch (error_) {
    if (current === generation) error.value = errorCode(error_);
  }
}

async function inspect() {
  if (!input.value) return;
  previewing.value = true;
  error.value = '';
  try {
    preview.value = await api.previewImport(input.value, crypto.randomUUID());
  } catch (error_) {
    error.value = errorCode(error_);
  } finally {
    previewing.value = false;
  }
}

async function apply() {
  if (!input.value || !preview.value) return;
  const saved = await confirm.run(
    'import',
    { ...input.value, preview_token: preview.value.preview_token },
    (value, key) => api.confirmImport(value, key),
  );
  if (saved) done(saved);
  else if (confirm.error.value === 'conflict') preview.value = undefined;
}
async function retry() {
  const saved = await confirm.retry();
  // The retried request is the original import confirmation.
  if (saved) done(saved as ImportResult);
}
function done(saved: ImportResult) {
  result.value = saved;
  preview.value = undefined;
  input.value = undefined;
  if (fileInput.value) fileInput.value.value = '';
}

const columns = computed(() => [
  { dataIndex: 'id', key: 'id', title: t('page.catalog.recordId') },
  { dataIndex: 'kind', key: 'kind', title: t('page.catalog.kind') },
  { key: 'state', title: t('page.common.status') },
  { key: 'fields', title: t('page.catalog.changedFields') },
]);
const stateColor: Record<string, string> = {
  new: 'green',
  updated: 'blue',
  conflict: 'red',
  unlinked: 'orange',
  preserved: 'purple',
};
</script>

<template>
  <AdminPage
    :title="t('page.catalog.importTitle')"
    :description="t('page.catalog.importIntro')"
  >
    <CampusPending v-if="!school" @ready="school = $event" />
    <div class="flex flex-col gap-4">
      <Card :bordered="false">
        <Form layout="vertical" class="max-w-2xl">
          <FormItem
            :label="t('page.catalog.importFile')"
            :extra="t('page.catalog.importFileHint')"
            html-for="import-file"
          >
            <input
              id="import-file"
              ref="fileInput"
              type="file"
              accept="application/json,.json"
              :disabled="!school || locked"
              @change="choose"
            />
          </FormItem>
        </Form>
        <Alert
          v-if="error"
          class="mb-4"
          type="error"
          show-icon
          role="alert"
          :message="
            error === 'school_mismatch'
              ? t('page.catalog.schoolMismatch')
              : errorText(error)
          "
        />
        <Descriptions
          v-if="input"
          size="small"
          bordered
          class="mb-4"
          :column="{ xs: 1, sm: 2 }"
        >
          <DescriptionsItem :label="t('page.catalog.source')">
{{
            input.source_id
          }}
</DescriptionsItem>
          <DescriptionsItem :label="t('page.common.revision')">
{{
            format.number(input.revision)
          }}
</DescriptionsItem>
          <DescriptionsItem :label="t('page.catalog.fetchedAt')">
{{
            format.dateTime(input.fetched_at)
          }}
</DescriptionsItem>
          <DescriptionsItem :label="t('page.catalog.importSize')">
{{
            t('page.catalog.importCounts', {
              objects: format.number(input.objects.length),
              enrollments: format.number(input.enrollments.length),
            })
          }}
</DescriptionsItem>
        </Descriptions>
        <Button
          :loading="previewing"
          :disabled="!input || confirm.busy.value || confirm.uncertain.value"
          @click="inspect"
          >
{{ t('page.catalog.previewImport') }}
</Button>
      </Card>

      <Card
        v-if="preview"
        :bordered="false"
        :title="t('page.catalog.previewTitle')"
      >
        <Alert
          v-if="!preview.valid"
          class="mb-4"
          type="error"
          show-icon
          :message="
            te(`page.errors.${preview.code}`)
              ? errorText(preview.code)
              : t('page.catalog.previewInvalid')
          "
        />
        <Table
          :columns="columns"
          :data-source="preview.changes"
          :pagination="{ pageSize: 50 }"
          :row-key="
            (row: ImportPreview['changes'][number]) => `${row.kind}:${row.id}`
          "
          size="small"
          :scroll="{ x: 640 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'state'">
<Tag :color="stateColor[record.state]">
{{
                te(`page.catalog.changeState.${record.state}`)
                  ? t(`page.catalog.changeState.${record.state}`)
                  : record.state
              }}
</Tag>
</template>
            <template v-else-if="column.key === 'fields'">
{{
              record.fields.join(', ')
            }}
</template>
          </template>
        </Table>
        <MutationAlert
          class="mt-4"
          :busy="confirm.busy.value"
          :error="confirm.error.value"
          :uncertain="confirm.uncertain.value"
          @retry="retry"
        />
        <Space class="mt-4">
          <Button
            type="primary"
            :loading="confirm.busy.value"
            :disabled="confirm.uncertain.value || !preview.valid"
            @click="apply"
            >
{{ t('page.catalog.confirmImport') }}
</Button>
        </Space>
      </Card>

      <Card v-if="result" :bordered="false">
        <Alert
          type="success"
          show-icon
          role="status"
          :message="
            t('page.catalog.imported', {
              objects: format.number(result.objects),
              enrollments: format.number(result.enrollments),
              preserved: format.number(result.preserved_corrections),
            })
          "
        />
      </Card>
    </div>
  </AdminPage>
</template>
