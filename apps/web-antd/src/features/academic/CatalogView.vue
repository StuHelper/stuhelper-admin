<script setup lang="ts">
import type { CatalogObject } from './api';

import { computed, reactive, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Form,
  FormItem,
  Input,
  Radio,
  RadioGroup,
  Table,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue';

import { ApiError } from '#/shared/api/errors';
import { useAsync, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';

import { pageSize, useAcademicAdmin } from './api';
import { useCampusId } from './campus';
import CampusPending from './CampusPending.vue';
import CatalogEditForm from './CatalogEditForm.vue';
import CatalogLifecyclePanel from './CatalogLifecyclePanel.vue';

/**
 * Catalog maintenance: list courses and teachers by school, and open a drawer
 * for field corrections (`CatalogEditForm`) or merge/deactivation
 * (`CatalogLifecyclePanel`).
 */
const { t } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useAcademicAdmin();
const school = useCampusId();
const kind = ref<'course' | 'teacher'>('course');
const query = ref('');
const selectedId = ref('');
const tab = ref<'edit' | 'lifecycle'>('edit');

const editState = reactive({ busy: false, dirty: false, uncertain: false });
const lifecycleState = reactive({ busy: false, dirty: false, uncertain: false });

const dirty = computed(() => editState.dirty || lifecycleState.dirty);
const uncertain = computed(
  () => editState.uncertain || lifecycleState.uncertain,
);
const busy = computed(
  () => editState.busy || lifecycleState.busy || uncertain.value,
);

function clearSelection() {
  selectedId.value = '';
  Object.assign(editState, { busy: false, dirty: false, uncertain: false });
  Object.assign(lifecycleState, { busy: false, dirty: false, uncertain: false });
}

const rows = usePaged(
  async (after, signal) => {
    if (!school.value) return { items: [], next: '' };
    const page = await api.objects(
      {
        kind: kind.value,
        school_id: school.value,
        q: query.value,
        after,
        limit: pageSize,
        include_inactive: true,
      },
      signal,
      true,
    );
    return { items: page.items, next: page.next };
  },
  { onDenied: clearSelection },
);

const options = useAsync(async (signal) => {
  const [departments, categories, natures] = await Promise.all(
    ['department', 'category', 'nature'].map((value) =>
      api.options({ kind: value, school_id: school.value }, signal),
    ),
  );
  return {
    departments: departments ?? [],
    categories: categories ?? [],
    natures: natures ?? [],
  };
});

const selected = useAsync(
  async (signal) => {
    const data = await api.summary(selectedId.value, signal);
    if (data.object.school_id !== school.value) throw new ApiError('forbidden');
    return data;
  },
  { onDenied: clearSelection },
);

const targets = useAsync(async (signal) =>
  selected.data.value
    ? api.options(
        { kind: selected.data.value.object.kind, school_id: school.value },
        signal,
      )
    : [],
);

const entry = computed(() => selected.data.value?.object);

watch([school, kind], () => {
  clearSelection();
  if (!school.value) return;
  void options.reload();
  void rows.reload();
});

function canLeave() {
  return (
    !(dirty.value || busy.value) ||
    window.confirm(
      t(
        uncertain.value
          ? 'page.common.leaveUncertain'
          : 'page.common.leaveUnsaved',
      ),
    )
  );
}
useLeaveGuard(() =>
  dirty.value || busy.value
    ? t(
        uncertain.value
          ? 'page.common.leaveUncertain'
          : 'page.common.leaveUnsaved',
      )
    : '',
);

async function open(id: string, compare = false) {
  if (!compare && selectedId.value && !canLeave()) return;
  selectedId.value = id;
  await selected.reload();
  if (!selected.data.value) return;
  if (!compare) {
    tab.value = 'edit';
    void targets.reload();
  }
}

function close() {
  if (!canLeave()) return;
  clearSelection();
}

async function onSaved() {
  await open(selectedId.value, true);
  void rows.reload();
}

async function onApplied(result: CatalogObject) {
  await open(result.id, true);
  void rows.reload();
}

const columns = computed(() => [
  { key: 'name', title: t('page.catalog.name') },
  ...(kind.value === 'course'
    ? [
        { key: 'code', title: t('page.catalog.code') },
        { key: 'credits', title: t('page.catalog.credits') },
      ]
    : []),
  { key: 'state', title: t('page.common.status') },
  { key: 'updated', title: t('page.common.updatedAt') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage :title="t('page.catalog.title')" :description="t('page.catalog.intro')">
    <div class="flex flex-col gap-4">
      <Card :bordered="false">
        <Form
          layout="inline"
          class="flex flex-wrap gap-y-3"
          @submit.prevent="rows.reload()"
        >
          <FormItem :label="t('page.catalog.kind')">
            <RadioGroup
              v-model:value="kind"
              option-type="button"
              :disabled="!!selectedId"
            >
              <Radio value="course">{{ t('page.catalog.courses') }}</Radio>
              <Radio value="teacher">{{ t('page.catalog.teachers') }}</Radio>
            </RadioGroup>
          </FormItem>
          <FormItem :label="t('page.common.keyword')" html-for="catalogview-field-1">
            <Input id="catalogview-field-1" v-model:value="query" :maxlength="200" allow-clear />
          </FormItem>
          <FormItem>
            <Button type="primary" html-type="submit" :disabled="!school">
              {{ t('page.common.search') }}
            </Button>
          </FormItem>
        </Form>
      </Card>

      <CampusPending v-if="!school" @ready="school = $event" />
      <Card v-else :bordered="false">
        <LoadState
          v-if="rows.items.value.length === 0"
          :status="rows.status.value"
          :error="rows.error.value"
          :empty="true"
          @retry="rows.reload"
        />
        <template v-else>
          <Table
            :columns="columns"
            :data-source="rows.items.value"
            :pagination="false"
            row-key="id"
            size="middle"
            :scroll="{ x: 640 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                {{ record.name }}
              </template>
              <template v-else-if="column.key === 'code'">
                <span class="font-mono">{{
                  record.code || t('page.common.notProvided')
                }}</span>
              </template>
              <template v-else-if="column.key === 'credits'">
                {{
                  typeof record.credits === 'number'
                    ? format.number(record.credits)
                    : t('page.catalog.creditsUnknown')
                }}
              </template>
              <template v-else-if="column.key === 'state'">
                <Tag :color="record.inactive ? 'orange' : 'green'">
                  {{
                    t(
                      record.inactive
                        ? 'page.catalog.inactive'
                        : 'page.catalog.active',
                    )
                  }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'updated'">
                {{ format.dateTime(record.updated_at) }}
              </template>
              <template v-else-if="column.key === 'action'">
                <Button type="link" size="small" @click="open(record.id)">
                  {{ t('page.common.edit') }}
                </Button>
              </template>
            </template>
          </Table>
          <div class="mt-4 flex justify-center">
            <Button
              v-if="rows.next.value"
              :loading="rows.appending.value"
              @click="rows.loadMore"
            >
              {{ t('page.common.loadMore') }}
            </Button>
          </div>
          <p
            v-if="rows.status.value === 'error'"
            class="text-destructive mt-2"
            role="alert"
          >
            {{ errorText(rows.error.value) }}
          </p>
        </template>
      </Card>
    </div>

    <Drawer
      :open="!!selectedId"
      :width="720"
      :title="entry?.name ?? t('page.catalog.title')"
      :mask-closable="false"
      destroy-on-close
      @close="close"
    >
      <LoadState
        :status="selected.status.value"
        :error="selected.error.value"
        @retry="open(selectedId, true)"
      >
        <div v-if="entry && selected.data.value" class="flex flex-col gap-4">
          <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
            <DescriptionsItem :label="t('page.common.school')">
              {{ selected.data.value.school.name }}
            </DescriptionsItem>
            <DescriptionsItem :label="t('page.common.revision')">
              {{ format.number(entry.revision) }}
            </DescriptionsItem>
            <DescriptionsItem :label="t('page.common.updatedAt')">
              {{ format.dateTime(entry.updated_at) }}
            </DescriptionsItem>
            <DescriptionsItem :label="t('page.common.status')">
              <Tag :color="entry.inactive ? 'orange' : 'green'">
                {{
                  t(
                    entry.inactive
                      ? 'page.catalog.inactive'
                      : 'page.catalog.active',
                  )
                }}
              </Tag>
            </DescriptionsItem>
            <DescriptionsItem
              v-if="entry.aliases.length > 0"
              :label="t('page.catalog.aliases')"
              :span="2"
            >
              {{ format.list(entry.aliases) }}
            </DescriptionsItem>
          </Descriptions>
          <Tabs v-model:active-key="tab">
            <TabPane
              key="edit"
              :tab="t('page.catalog.correct')"
              :disabled="lifecycleState.dirty"
            >
              <CatalogEditForm
                :entry="entry"
                :departments="options.data.value?.departments"
                :categories="options.data.value?.categories"
                :natures="options.data.value?.natures"
                :external-busy="lifecycleState.busy || lifecycleState.uncertain"
                @state="
                  (b, u, d) =>
                    Object.assign(editState, { busy: b, uncertain: u, dirty: d })
                "
                @saved="onSaved"
                @reload-compare="open(selectedId, true)"
                @denied="clearSelection"
              />
            </TabPane>
            <TabPane
              key="lifecycle"
              :tab="t('page.catalog.lifecycle')"
              :disabled="editState.dirty"
            >
              <CatalogLifecyclePanel
                :entry="entry"
                :targets="targets.data.value"
                :external-busy="editState.busy || editState.uncertain"
                @state="
                  (b, u, d) =>
                    Object.assign(lifecycleState, {
                      busy: b,
                      uncertain: u,
                      dirty: d,
                    })
                "
                @applied="onApplied"
                @denied="clearSelection"
              />
            </TabPane>
          </Tabs>
        </div>
      </LoadState>
    </Drawer>
  </AdminPage>
</template>
