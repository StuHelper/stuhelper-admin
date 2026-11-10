<script setup lang="ts">
import type { ResourcePrice } from './api';

import { computed, reactive, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Form, FormItem, Input, InputNumber } from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { minorText, parseMinor, useBillingAdmin } from './api';

/**
 * Price of one resource, owned by billing. Users pay the whole price from one
 * account, so each price is offered on its own; at least one is required.
 */
const props = defineProps<{ resourceId: string }>();
const emit = defineEmits<{ pending: [busy: boolean] }>();
const { t } = useI18n();
const errorText = useErrorText();
const api = useBillingAdmin();
const write = useMutation();
const form = reactive({ points: undefined as number | undefined, ivory: '' });
const baseline = ref('');
const loadError = ref('');
const unpriced = ref(false);
const success = ref('');

async function load() {
  loadError.value = '';
  unpriced.value = false;
  try {
    show(await api.resourcePrice(props.resourceId));
  } catch (error) {
    const code = errorCode(error);
    if (code === 'billing_not_found' || code === 'not_found') {
      unpriced.value = true;
      show({ resource_id: props.resourceId });
    } else loadError.value = code;
  }
}
function show(price: ResourcePrice) {
  Object.assign(form, { points: price.points ?? undefined, ivory: price.ivory_minor ? minorText(price.ivory_minor) : '' });
  baseline.value = JSON.stringify(form);
}
watch(() => props.resourceId, () => {
  success.value = '';
  void load();
}, { immediate: true });

const ivory = computed(() => (form.ivory.trim() ? parseMinor(form.ivory) : null));
const ready = computed(() => ivory.value !== undefined && ivory.value !== 0 && (!!form.points || !!ivory.value));
const dirty = computed(() => JSON.stringify(form) !== baseline.value);
watch([dirty, write.busy, write.uncertain], () => emit('pending', dirty.value || write.busy.value || write.uncertain.value));

async function save() {
  if (!ready.value) return;
  success.value = '';
  const body: ResourcePrice = { resource_id: props.resourceId, points: form.points || null, ivory_minor: ivory.value ?? null };
  const result = await write.run(`price:${body.resource_id}`, body, (value, key) => api.saveResourcePrice(value, key));
  if (result) saved(result);
}
async function retry() {
  const result = (await write.retry()) as ResourcePrice | undefined;
  if (result) saved(result);
}
function saved(result: ResourcePrice) {
  unpriced.value = false;
  show(result);
  success.value = t('page.common.saved');
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <Alert v-if="loadError" type="error" show-icon :message="errorText(loadError)">
      <template #action><Button size="small" @click="load">{{ t('page.common.retry') }}</Button></template>
    </Alert>
    <template v-else>
      <Alert type="info" show-icon :message="t(unpriced ? 'page.resources.price.unpriced' : 'page.resources.price.hint')" />
      <Form layout="vertical" @submit.prevent="save">
        <FormItem :label="t('page.resources.price.points')" html-for="resource-price-points">
          <InputNumber id="resource-price-points" v-model:value="form.points" :min="1" :precision="0" :disabled="write.busy.value || write.uncertain.value" />
        </FormItem>
        <FormItem :label="t('page.resources.price.ivory')" :validate-status="ivory === undefined || ivory === 0 ? 'error' : undefined" :help="ivory === undefined || ivory === 0 ? t('page.billing.memberships.ivoryInvalid') : undefined" html-for="resource-price-ivory">
          <Input id="resource-price-ivory" v-model:value="form.ivory" inputmode="decimal" autocomplete="off" :disabled="write.busy.value || write.uncertain.value" />
        </FormItem>
        <MutationAlert :busy="write.busy.value" :error="write.error.value" :uncertain="write.uncertain.value" :success="success" @retry="retry" />
        <Button class="mt-3" type="primary" html-type="submit" :loading="write.busy.value" :disabled="!ready || !dirty || write.uncertain.value">{{ t('page.resources.price.save') }}</Button>
      </Form>
    </template>
  </div>
</template>
