<script setup lang="ts">
import type { CatalogObject, MergeInput, MergePreview } from './api';

import { computed, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Form,
  FormItem,
  Select,
  Space,
  Textarea,
} from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useAcademicAdmin } from './api';

const props = defineProps<{
  entry: CatalogObject;
  externalBusy?: boolean;
  targets?: CatalogObject[];
}>();

const emit = defineEmits<{
  applied: [result: CatalogObject, message: 'page.catalog.merged' | 'page.common.saved'];
  denied: [];
  state: [busy: boolean, uncertain: boolean, dirty: boolean];
}>();

const { t } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useAcademicAdmin();
const lifecycle = useMutation({ onDenied: () => emit('denied') });

const target = ref('');
const reason = ref('');
const plan = shallowRef<MergePreview>();
const planError = ref('');
const intent = ref<'merge' | 'state'>('merge');

const busy = computed(
  () => !!props.externalBusy || lifecycle.busy.value || lifecycle.uncertain.value,
);
const targetObject = computed(() =>
  props.targets?.find((item) => item.id === target.value),
);

watch(
  () => props.entry.id,
  () => {
    target.value = '';
    reason.value = '';
    plan.value = undefined;
    planError.value = '';
    lifecycle.dismiss();
  },
);
watch([target, reason], () => {
  plan.value = undefined;
});
watch(
  [() => lifecycle.busy.value, () => lifecycle.uncertain.value, reason],
  () =>
    emit(
      'state',
      lifecycle.busy.value,
      lifecycle.uncertain.value,
      !!reason.value,
    ),
  { immediate: true },
);

function mergeInput(): MergeInput {
  return {
    target_id: target.value,
    source_revision: props.entry.revision,
    target_revision: targetObject.value?.revision ?? 0,
    reason: reason.value,
  };
}

async function previewMerge() {
  planError.value = '';
  try {
    plan.value = await api.previewMerge(
      props.entry.id,
      mergeInput(),
      crypto.randomUUID(),
    );
  } catch (error) {
    planError.value = errorCode(error);
  }
}

async function apply(action: 'merge' | 'state') {
  const object = props.entry;
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
  if (result) done(result);
}

async function retryLifecycle() {
  const result = await lifecycle.retry();
  if (result) done(result as CatalogObject);
}

function done(result: CatalogObject) {
  reason.value = '';
  plan.value = undefined;
  emit('applied', result, intent.value === 'merge' ? 'page.catalog.merged' : 'page.common.saved');
}
</script>

<template>
  <div>
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
            ...(targets ?? [])
              .filter((item) => item.id !== entry.id)
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
          {{ t('page.common.revisionValue', { value: record.revision }) }}
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
          t(entry.inactive ? 'page.catalog.activate' : 'page.catalog.deactivate')
        }}
      </Button>
    </Space>
  </div>
</template>
