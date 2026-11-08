<script setup lang="ts">
import type { Order, PaymentReviewInput, Target } from './api';

import { computed, reactive } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Form, FormItem, Input, Radio, RadioGroup, Textarea } from 'ant-design-vue';

import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useBillingAdmin } from './api';

/**
 * Handle an order whose automatic payment queries ran out (needs_review). An
 * administrator either schedules one more channel query or records the result
 * verified with the channel. The verification evidence is cited by reference only.
 */
const props = defineProps<{ order: Pick<Order, 'id'>; target: Target }>();
const emit = defineEmits<{ done: [order: Order, action: PaymentReviewInput['action']] }>();
const { t } = useI18n();
const api = useBillingAdmin();
const form = reactive({ action: 'retry_query' as PaymentReviewInput['action'], reason: '', evidence: '' });
const write = useMutation();
const locked = computed(() => write.busy.value || write.uncertain.value);
const ready = computed(() => !!form.reason.trim() && !!form.evidence.trim());
useLeaveGuard(() => (write.uncertain.value ? t('page.common.leaveUncertain') : (form.reason.trim() || form.evidence.trim() ? t('page.common.leaveUnsaved') : '')));

async function submit() {
  if (!ready.value) return;
  const body: PaymentReviewInput = { target: props.target, action: form.action, reason: form.reason.trim(), evidence_reference: form.evidence.trim() };
  const result = await write.run(`payment-review:${props.order.id}`, body, (value, key) => api.paymentReview(props.order.id, value, key));
  if (result) emit('done', result, body.action);
}
async function retry() {
  const result = (await write.retry()) as Order | undefined;
  if (result) emit('done', result, form.action);
}
</script>

<template>
  <Form layout="vertical" @submit.prevent="submit">
    <p class="text-muted-foreground text-sm">{{ t('page.billing.review.intro') }}</p>
    <FormItem :label="t('page.billing.review.action')">
      <RadioGroup v-model:value="form.action" :disabled="locked">
        <Radio value="retry_query">{{ t('page.billing.review.retry_query') }}</Radio>
        <Radio value="confirm_succeeded">{{ t('page.billing.review.confirm_succeeded') }}</Radio>
        <Radio value="confirm_failed">{{ t('page.billing.review.confirm_failed') }}</Radio>
      </RadioGroup>
    </FormItem>
    <FormItem :label="t('page.billing.review.evidence')" required :extra="t('page.billing.review.evidenceHint')" html-for="billing-review-evidence">
      <Input id="billing-review-evidence" v-model:value="form.evidence" :maxlength="256" :disabled="locked" autocomplete="off" />
    </FormItem>
    <FormItem :label="t('page.common.reason')" required html-for="billing-review-reason">
      <Textarea id="billing-review-reason" v-model:value="form.reason" :rows="2" :maxlength="1000" :disabled="locked" />
    </FormItem>
    <MutationAlert :busy="write.busy.value" :error="write.error.value" :uncertain="write.uncertain.value" @retry="retry" />
    <Button class="mt-3" type="primary" html-type="submit" :danger="form.action === 'confirm_failed'" :loading="write.busy.value" :disabled="!ready || write.uncertain.value">{{ t('page.billing.review.submit') }}</Button>
  </Form>
</template>
