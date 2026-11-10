<script setup lang="ts">
import type {
  CatalogObject,
  Correction,
  MergeInput,
  MergePreview,
} from './api';

import { computed, reactive, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Form,
  FormItem,
  Input,
  InputNumber,
  Radio,
  RadioGroup,
  Select,
  Space,
  Table,
  TabPane,
  Tabs,
  Tag,
  Textarea,
} from 'ant-design-vue';

import { ApiError, errorCode } from '#/shared/api/errors';
import { useAsync, useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { pageSize, useAcademicAdmin } from './api';
import { useCampusId } from './campus';
import CampusPending from './CampusPending.vue';

/**
 * Catalog maintenance: correct courses and teachers, merge duplicates and
 * deactivate records. Missing facts stay unknown instead of becoming zero, and
 * manual corrections take precedence over later imports.
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
const fields = reactive({
  name: '',
  biography: '',
  department: '',
  category: '',
  nature: '',
  code: '',
  credits: undefined as number | undefined,
  unknownCredits: true,
});
const baseline = ref('');
const success = ref('');
const correcting = useMutation();
const lifecycle = useMutation();
const target = ref('');
const reason = ref('');
const plan = shallowRef<MergePreview>();
const planError = ref('');
const intent = ref<'merge' | 'state'>('merge');

const form = () => JSON.stringify(fields);
const dirty = computed(
  () => baseline.value !== '' && baseline.value !== form(),
);
const busy = computed(
  () =>
    correcting.busy.value ||
    correcting.uncertain.value ||
    lifecycle.busy.value ||
    lifecycle.uncertain.value,
);

const rows = usePaged(async (after, signal) => {
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
  );
  return { items: page.items, next: page.next };
});
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
const selected = useAsync(async (signal) => {
  const data = await api.summary(selectedId.value, signal);
  if (data.object.school_id !== school.value) throw new ApiError('forbidden');
  return data;
});
const targets = useAsync(async (signal) =>
  selected.data.value
    ? api.options(
        { kind: selected.data.value.object.kind, school_id: school.value },
        signal,
      )
    : [],
);
const entry = computed(() => selected.data.value?.object);
const targetObject = computed(() =>
  targets.data.value?.find((item) => item.id === target.value),
);

watch([school, kind], () => {
  selectedId.value = '';
  if (!school.value) return;
  void options.reload();
  void rows.reload();
});
watch([target, reason], () => {
  plan.value = undefined;
});

function canLeave() {
  return (
    !(dirty.value || busy.value || !!reason.value) ||
    window.confirm(
      t(
        correcting.uncertain.value || lifecycle.uncertain.value
          ? 'page.common.leaveUncertain'
          : 'page.common.leaveUnsaved',
      ),
    )
  );
}
useLeaveGuard(() => (dirty.value || busy.value || !!reason.value ? t(correcting.uncertain.value || lifecycle.uncertain.value ? 'page.common.leaveUncertain' : 'page.common.leaveUnsaved') : ''));

function fill(object: CatalogObject) {
  fields.name = object.name;
  fields.biography = object.biography ?? '';
  fields.department = object.department_id ?? '';
  fields.category = object.category_id ?? '';
  fields.nature = object.nature_id ?? '';
  fields.code = object.code ?? '';
  fields.unknownCredits = typeof object.credits !== 'number';
  fields.credits =
    typeof object.credits === 'number' ? object.credits : undefined;
  baseline.value = form();
}

async function open(id: string, compare = false) {
  if (!compare && selectedId.value && !canLeave()) return;
  selectedId.value = id;
  success.value = '';
  await selected.reload();
  const object = selected.data.value?.object;
  if (!object) return;
  if (!compare) {
    fill(object);
    tab.value = 'edit';
    target.value = '';
    reason.value = '';
    void targets.reload();
  }
}
function close() {
  if (!canLeave()) return;
  selectedId.value = '';
  baseline.value = '';
  reason.value = '';
}

async function save() {
  const object = entry.value;
  if (!object) return;
  success.value = '';
  const body: Correction = {
    revision: object.revision,
    name: fields.name,
    biography: fields.biography,
    department_id: fields.department,
    ...(object.kind === 'course'
      ? {
          code: fields.code,
          category_id: fields.category,
          nature_id: fields.nature,
          clear_credits: fields.unknownCredits,
          ...(fields.unknownCredits ? {} : { credits: fields.credits }),
        }
      : {}),
  };
  if (
    await correcting.run(`correct:${object.id}`, body, (value, key) =>
      api.correct(object.id, value, key),
    )
  )
    corrected();
}
async function retrySave() {
  if (await correcting.retry()) corrected();
}
async function corrected() {
  baseline.value = form();
  await open(selectedId.value, true);
  if (entry.value) fill(entry.value);
  success.value = t('page.common.saved');
  void rows.reload();
}

function mergeInput(): MergeInput {
  return {
    target_id: target.value,
    source_revision: entry.value?.revision ?? 0,
    target_revision: targetObject.value?.revision ?? 0,
    reason: reason.value,
  };
}
async function previewMerge() {
  const object = entry.value;
  if (!object) return;
  planError.value = '';
  try {
    plan.value = await api.previewMerge(
      object.id,
      mergeInput(),
      crypto.randomUUID(),
    );
  } catch (error) {
    planError.value = errorCode(error);
  }
}
async function apply(action: 'merge' | 'state') {
  const object = entry.value;
  if (!object) return;
  intent.value = action;
  const result =
    action === 'merge'
      ? await lifecycle.run(
          `merge:${object.id}`,
          { ...mergeInput(), preview_token: plan.value?.preview_token },
          (value, key) => api.merge(object.id, value, key),
        )
      : await lifecycle.run(
          `state:${object.id}`,
          {
            revision: object.revision,
            inactive: !object.inactive,
            reason: reason.value,
          },
          (value, key) => api.setState(object.id, value, key),
        );
  if (result) applied(result);
}
async function retryLifecycle() {
  const result = await lifecycle.retry();
  // The retried request returns the merged or updated catalog object.
  if (result) applied(result as CatalogObject);
}
async function applied(result: CatalogObject) {
  reason.value = '';
  plan.value = undefined;
  baseline.value = '';
  await open(result.id, true);
  if (entry.value) fill(entry.value);
  success.value = t(
    intent.value === 'merge' ? 'page.catalog.merged' : 'page.common.saved',
  );
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
const choice = (items: CatalogObject[] | undefined) => [
  { value: '', label: t('page.common.notProvided') },
  ...(items ?? []).map((item) => ({ value: item.id, label: item.name })),
];
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
{{
              t('page.common.search')
            }}
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
{{
                record.name
              }}
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
{{
                format.dateTime(record.updated_at)
              }}
</template>
              <template v-else-if="column.key === 'action'">
<Button type="link" size="small" @click="open(record.id)">
{{
                  t('page.common.edit')
                }}
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
{{
              selected.data.value.school.name
            }}
</DescriptionsItem>
            <DescriptionsItem :label="t('page.common.revision')">
{{
              format.number(entry.revision)
            }}
</DescriptionsItem>
            <DescriptionsItem :label="t('page.common.updatedAt')">
{{
              format.dateTime(entry.updated_at)
            }}
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
              :disabled="!!reason"
            >
              <Form layout="vertical" @submit.prevent="save">
                <FormItem :label="t('page.catalog.name')" required html-for="catalogview-field-2">
                  <Input
id="catalogview-field-2"
                    v-model:value="fields.name"
                    :maxlength="256"
                    :disabled="busy"
                  />
                </FormItem>
                <FormItem :label="t('page.catalog.biography')" html-for="catalogview-field-3">
                  <Textarea
id="catalogview-field-3"
                    v-model:value="fields.biography"
                    :rows="5"
                    :maxlength="8000"
                    :disabled="busy"
                  />
                </FormItem>
                <FormItem
                  :label="
                    t(
                      entry.kind === 'course'
                        ? 'page.catalog.college'
                        : 'page.catalog.department',
                    )
                  "
                 html-for="catalogview-field-4"
>
                  <Select
id="catalogview-field-4"
                    v-model:value="fields.department"
                    :disabled="busy"
                    :options="choice(options.data.value?.departments)"
                    show-search
                    option-filter-prop="label"
                  />
                </FormItem>
                <template v-if="entry.kind === 'course'">
                  <div class="grid gap-4 md:grid-cols-2">
                    <FormItem :label="t('page.catalog.code')" html-for="catalogview-field-5">
                      <Input
id="catalogview-field-5"
                        v-model:value="fields.code"
                        :maxlength="128"
                        :disabled="busy"
                      />
                    </FormItem>
                    <FormItem
                      :label="t('page.catalog.credits')"
                      :extra="t('page.catalog.creditsHint')"
                    >
                      <Space>
                        <InputNumber
                          v-model:value="fields.credits"
                          :min="0"
                          :max="100"
                          :disabled="busy || fields.unknownCredits"
                        />
                        <Checkbox
                          v-model:checked="fields.unknownCredits"
                          :disabled="busy"
                          >
{{ t('page.catalog.creditsUnknown') }}
</Checkbox>
                      </Space>
                    </FormItem>
                    <FormItem :label="t('page.catalog.category')" html-for="catalogview-field-6">
                      <Select
id="catalogview-field-6"
                        v-model:value="fields.category"
                        :disabled="busy"
                        :options="choice(options.data.value?.categories)"
                      />
                    </FormItem>
                    <FormItem :label="t('page.catalog.nature')" html-for="catalogview-field-7">
                      <Select
id="catalogview-field-7"
                        v-model:value="fields.nature"
                        :disabled="busy"
                        :options="choice(options.data.value?.natures)"
                      />
                    </FormItem>
                  </div>
                </template>
                <Alert
                  v-if="correcting.error.value === 'conflict'"
                  class="mb-4"
                  type="warning"
                  show-icon
                  :message="t('page.common.compareNotice')"
                  :description="
                    t('page.catalog.savedValues', { name: entry.name })
                  "
                />
                <MutationAlert
                  :busy="correcting.busy.value"
                  :error="correcting.error.value"
                  :uncertain="correcting.uncertain.value"
                  :success="success"
                  @retry="retrySave"
                />
                <Space class="mt-4" wrap>
                  <Button
                    type="primary"
                    html-type="submit"
                    :loading="correcting.busy.value"
                    :disabled="
                      correcting.uncertain.value ||
                      !dirty ||
                      (!fields.unknownCredits && fields.credits === undefined)
                    "
                    >
{{ t('page.common.save') }}
</Button>
                  <Button
                    v-if="correcting.error.value === 'conflict'"
                    :disabled="busy"
                    @click="open(selectedId, true)"
                    >
{{ t('page.common.reloadCompare') }}
</Button>
                </Space>
              </Form>
            </TabPane>
            <TabPane
              key="lifecycle"
              :tab="t('page.catalog.lifecycle')"
              :disabled="dirty"
            >
              <Alert
                class="mb-4"
                type="info"
                show-icon
                :message="t('page.catalog.mergeHint')"
              />
              <Form layout="vertical">
                <FormItem :label="t('page.catalog.mergeTarget')" html-for="catalogview-field-8">
                  <Select
id="catalogview-field-8"
                    v-model:value="target"
                    :disabled="busy"
                    show-search
                    option-filter-prop="label"
                    :options="[
                      { value: '', label: t('page.common.choose') },
                      ...(targets.data.value ?? [])
                        .filter((item) => item.id !== entry?.id)
                        .map((item) => ({ value: item.id, label: item.name })),
                    ]"
                  />
                </FormItem>
                <FormItem :label="t('page.catalog.reason')" required html-for="catalogview-field-9">
                  <Textarea
id="catalogview-field-9"
                    v-model:value="reason"
                    :rows="3"
                    :maxlength="2000"
                    :disabled="busy"
                  />
                </FormItem>
              </Form>
              <div v-if="plan" class="mb-4 grid gap-3 md:grid-cols-2">
                <Card
                  v-for="(record, index) in [plan.source, plan.target]"
                  :key="record.id"
                  size="small"
                  :title="
                    t(
                      index === 0
                        ? 'page.catalog.mergeSource'
                        : 'page.catalog.mergeTarget',
                    )
                  "
                >
                  <p class="font-semibold">{{ record.name }}</p>
                  <p class="text-muted-foreground text-sm">
                    {{
                      t('page.common.revisionValue', { value: record.revision })
                    }}
                  </p>
                  <p v-if="record.biography" class="text-sm">
                    {{ record.biography }}
                  </p>
                </Card>
                <p class="text-sm md:col-span-2">
                  {{
                    t('page.catalog.mergeAliases', {
                      count: format.number(plan.aliases),
                    })
                  }}
                </p>
              </div>
              <p v-if="planError" class="text-destructive mb-2" role="alert">
                {{ errorText(planError) }}
              </p>
              <MutationAlert
                :busy="lifecycle.busy.value"
                :error="lifecycle.error.value"
                :uncertain="lifecycle.uncertain.value"
                :success="success"
                @retry="retryLifecycle"
              />
              <Space class="mt-4" wrap>
                <Button
                  :disabled="busy || !targetObject || !reason.trim()"
                  @click="previewMerge"
                  >
{{ t('page.catalog.previewMerge') }}
</Button>
                <Button
                  v-if="plan"
                  type="primary"
                  :loading="lifecycle.busy.value"
                  :disabled="lifecycle.uncertain.value"
                  @click="apply('merge')"
                  >
{{ t('page.catalog.confirmMerge') }}
</Button>
                <Button
                  :danger="!entry.inactive"
                  :loading="lifecycle.busy.value"
                  :disabled="lifecycle.uncertain.value || !reason.trim()"
                  @click="apply('state')"
                  >
{{
                    t(
                      entry.inactive
                        ? 'page.catalog.activate'
                        : 'page.catalog.deactivate',
                    )
                  }}
</Button>
              </Space>
            </TabPane>
          </Tabs>
        </div>
      </LoadState>
    </Drawer>
  </AdminPage>
</template>
