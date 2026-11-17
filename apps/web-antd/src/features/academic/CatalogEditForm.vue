<script setup lang="ts">
import type { CatalogObject, Correction } from './api';

import { computed, reactive, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Checkbox,
  Form,
  FormItem,
  Input,
  InputNumber,
  Select,
  Space,
  Textarea,
} from 'ant-design-vue';

import { useMutation } from '#/shared/composables/async';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useAcademicAdmin } from './api';

const props = defineProps<{
  categories?: CatalogObject[];
  departments?: CatalogObject[];
  entry: CatalogObject;
  externalBusy?: boolean;
  natures?: CatalogObject[];
}>();

const emit = defineEmits<{
  denied: [];
  reloadCompare: [];
  saved: [];
  state: [busy: boolean, uncertain: boolean, dirty: boolean];
}>();

const { t } = useI18n();
const api = useAcademicAdmin();
const correcting = useMutation({ onDenied: () => emit('denied') });

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

const snapshot = () => JSON.stringify(fields);
const dirty = computed(
  () => baseline.value !== '' && baseline.value !== snapshot(),
);
const busy = computed(
  () =>
    !!props.externalBusy || correcting.busy.value || correcting.uncertain.value,
);

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
  baseline.value = snapshot();
}

watch(
  () => props.entry,
  (next, previous) => {
    // Keep user edits intact during a conflict reload comparison of the same object.
    if (previous?.id === next.id && correcting.error.value === 'conflict') {
      return;
    }
    correcting.dismiss();
    fill(next);
  },
  { immediate: true },
);

watch(
  [() => correcting.busy.value, () => correcting.uncertain.value, dirty],
  () =>
    emit(
      'state',
      correcting.busy.value,
      correcting.uncertain.value,
      dirty.value,
    ),
  { immediate: true },
);

const choice = (items: CatalogObject[] | undefined) => [
  { value: '', label: t('page.common.notProvided') },
  ...(items ?? []).map((item) => ({ value: item.id, label: item.name })),
];

async function save() {
  const object = props.entry;
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
  ) {
    corrected();
  }
}

async function retrySave() {
  if (await correcting.retry()) corrected();
}

function corrected() {
  baseline.value = snapshot();
  success.value = t('page.common.saved');
  emit('saved');
}
</script>

<template>
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
        :options="choice(departments)"
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
            <Checkbox v-model:checked="fields.unknownCredits" :disabled="busy">
              {{ t('page.catalog.creditsUnknown') }}
            </Checkbox>
          </Space>
        </FormItem>
        <FormItem :label="t('page.catalog.category')" html-for="catalogview-field-6">
          <Select
            id="catalogview-field-6"
            v-model:value="fields.category"
            :disabled="busy"
            :options="choice(categories)"
          />
        </FormItem>
        <FormItem :label="t('page.catalog.nature')" html-for="catalogview-field-7">
          <Select
            id="catalogview-field-7"
            v-model:value="fields.nature"
            :disabled="busy"
            :options="choice(natures)"
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
      :description="t('page.catalog.savedValues', { name: entry.name })"
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
        @click="emit('reloadCompare')"
      >
        {{ t('page.common.reloadCompare') }}
      </Button>
    </Space>
  </Form>
</template>
