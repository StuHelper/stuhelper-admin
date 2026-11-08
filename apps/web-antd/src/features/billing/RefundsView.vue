<script setup lang="ts">
import type { AdminOrder, ManualInput, Order, ReviewInput } from './api';

import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Card, Checkbox, Descriptions, DescriptionsItem, Drawer, Form, FormItem, Input, Radio, RadioGroup, Segmented, Table, Tag, Textarea } from 'ant-design-vue';

import { useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { refundStates, useBillingAdmin } from './api';
import { useMoney } from './money';
import PaymentReview from './PaymentReview.vue';

/**
 * Refund queue. A submitted refund is approved or rejected; approval either
 * returns the money through the original payment route or hands it to manual
 * payout. A manual payout is closed by recording its real result.
 */
type State = (typeof refundStates)[number];
const { t } = useI18n();
const format = useFormat();
const money = useMoney();
const api = useBillingAdmin();
const filter = ref<State>('submitted');
const refunds = usePaged<AdminOrder>((after, signal) => api.refunds(filter.value, after, signal));
onMounted(refunds.reload);
watch(filter, () => void refunds.reload());

const selected = shallowRef<AdminOrder>();
const reviewForm = reactive({ approve: true, manual: false, reason: '' });
const manualForm = reactive({ succeeded: true, channel: '', reference: '', reason: '' });
const write = useMutation();
const success = ref('');
const dirty = computed(() => !!selected.value && (!!reviewForm.reason.trim() || !!manualForm.channel.trim() || !!manualForm.reference.trim() || !!manualForm.reason.trim()));
useLeaveGuard(() => (write.uncertain.value ? t('page.common.leaveUncertain') : (dirty.value || write.busy.value ? t('page.common.leaveUnsaved') : '')));
const locked = computed(() => write.busy.value || write.uncertain.value);

function open(order: AdminOrder) {
  selected.value = order;
  success.value = '';
  write.dismiss();
  Object.assign(reviewForm, { approve: true, manual: false, reason: '' });
  Object.assign(manualForm, { succeeded: true, channel: '', reference: '', reason: '' });
}
function close() {
  if (!locked.value) selected.value = undefined;
}
// Rejecting needs a reason the user can read; a failed payout needs the cause.
const reviewReady = computed(() => reviewForm.approve || !!reviewForm.reason.trim());
const manualReady = computed(() => !!manualForm.channel.trim() && (manualForm.succeeded ? !!manualForm.reference.trim() : !!manualForm.reason.trim()));

async function submitReview() {
  const order = selected.value;
  if (!order || !reviewReady.value) return;
  const body: ReviewInput = { target: order.target, approve: reviewForm.approve, manual: reviewForm.approve && reviewForm.manual, reason: reviewForm.reason.trim() };
  const result = await write.run(`review:${order.id}`, body, (value, key) => api.review(order.id, value, key));
  if (result) done(order, result, reviewForm.approve ? 'approved' : 'rejected');
}
async function submitManual() {
  const order = selected.value;
  if (!order || !manualReady.value) return;
  const body: ManualInput = { target: order.target, succeeded: manualForm.succeeded, payment_channel: manualForm.channel.trim(), payment_reference: manualForm.succeeded ? manualForm.reference.trim() : '', reason: manualForm.reason.trim() };
  const result = await write.run(`manual:${order.id}`, body, (value, key) => api.manualResult(order.id, value, key));
  if (result) done(order, result, manualForm.succeeded ? 'paid' : 'payoutFailed');
}
async function retry() {
  const order = selected.value;
  const result = (await write.retry()) as Order | undefined;
  if (order && result) done(order, result, 'recorded');
}
function done(order: AdminOrder, result: Order, message: string) {
  const updated: AdminOrder = { ...result, target: order.target };
  selected.value = updated;
  success.value = t(`page.billing.refunds.done.${message}`);
  // The row leaves the current filter when its state changed.
  refunds.items.value = refunds.items.value.flatMap((item) => (item.id === order.id ? (updated.state === filter.value ? [updated] : []) : [item]));
}

const stateColor: Record<string, string> = { needs_review: 'red', review_query_pending: 'gold', submitted: 'blue', processing: 'gold', awaiting_details: 'orange', awaiting_manual: 'orange', succeeded: 'green', failed: 'red', rejected: 'default' };
const columns = computed(() => [
  { key: 'created', title: t('page.common.createdAt') },
  { key: 'amount', title: t('page.billing.amount') },
  { key: 'account', title: t('page.billing.account') },
  { key: 'state', title: t('page.common.status') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage :title="t('page.billing.refunds.title')" :description="t('page.billing.refunds.intro')">
    <Card :bordered="false">
      <Segmented v-model:value="filter" class="mb-4 max-w-full overflow-x-auto" :options="refundStates.map((value) => ({ value, label: t(`page.billing.orderState.${value}`) }))" />
      <LoadState v-if="refunds.items.value.length === 0" :status="refunds.status.value" :error="refunds.error.value" :empty="true" :empty-text="t('page.billing.refunds.empty')" @retry="refunds.reload" />
      <template v-else>
        <Table :columns="columns" :data-source="refunds.items.value" :pagination="false" row-key="id" size="middle" :scroll="{ x: 720 }">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'created'">{{ format.dateTime(record.created_at) }}</template>
            <template v-else-if="column.key === 'amount'">{{ money.order(record as AdminOrder) }}</template>
            <template v-else-if="column.key === 'account'"><code class="break-all text-xs">{{ record.target.subject }}</code></template>
            <template v-else-if="column.key === 'state'"><Tag :color="stateColor[record.state]">{{ t(`page.billing.orderState.${record.state}`) }}</Tag></template>
            <template v-else-if="column.key === 'action'"><Button type="link" size="small" @click="open(record as AdminOrder)">{{ t('page.billing.refunds.handle') }}</Button></template>
          </template>
        </Table>
        <div class="mt-4 flex justify-center">
          <Button v-if="refunds.next.value" :loading="refunds.appending.value" @click="refunds.loadMore">{{ t('page.common.loadMore') }}</Button>
        </div>
      </template>
    </Card>

    <Drawer :open="!!selected" :width="640" :title="t('page.billing.refunds.drawer')" :mask-closable="false" destroy-on-close @close="close">
      <div v-if="selected" class="flex flex-col gap-4">
        <Descriptions :column="1" size="small" bordered>
          <DescriptionsItem :label="t('page.billing.orderId')"><code class="break-all">{{ selected.id }}</code></DescriptionsItem>
          <DescriptionsItem :label="t('page.common.status')"><Tag :color="stateColor[selected.state]">{{ t(`page.billing.orderState.${selected.state}`) }}</Tag></DescriptionsItem>
          <DescriptionsItem :label="t('page.billing.amount')">{{ money.order(selected) }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.billing.issuer')"><code class="break-all">{{ selected.target.issuer }}</code></DescriptionsItem>
          <DescriptionsItem :label="t('page.billing.subject')"><code class="break-all">{{ selected.target.subject }}</code></DescriptionsItem>
          <DescriptionsItem :label="t('page.billing.reference')"><code class="break-all">{{ selected.reference || t('page.common.notProvided') }}</code></DescriptionsItem>
          <DescriptionsItem :label="t('page.billing.channel')">{{ selected.channel || t('page.common.notProvided') }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.common.reason')">{{ selected.reason || t('page.common.notProvided') }}</DescriptionsItem>
          <DescriptionsItem v-if="selected.receipt_reference" :label="t('page.billing.refunds.receipt')"><code class="break-all">{{ selected.receipt_reference }}</code></DescriptionsItem>
          <DescriptionsItem v-if="selected.failure_code" :label="t('page.billing.failureCode')"><code>{{ selected.failure_code }}</code></DescriptionsItem>
          <DescriptionsItem :label="t('page.common.createdAt')">{{ format.dateTime(selected.created_at) }}</DescriptionsItem>
        </Descriptions>

        <Form v-if="selected.state === 'submitted' && !success" layout="vertical" @submit.prevent="submitReview">
          <FormItem :label="t('page.billing.refunds.decision')">
            <RadioGroup v-model:value="reviewForm.approve" :disabled="locked">
              <Radio :value="true">{{ t('page.billing.refunds.approve') }}</Radio>
              <Radio :value="false">{{ t('page.billing.refunds.reject') }}</Radio>
            </RadioGroup>
          </FormItem>
          <FormItem v-if="reviewForm.approve" :extra="t('page.billing.refunds.manualHint')">
            <Checkbox v-model:checked="reviewForm.manual" :disabled="locked">{{ t('page.billing.refunds.manual') }}</Checkbox>
          </FormItem>
          <FormItem :label="t('page.common.reason')" :required="!reviewForm.approve" :extra="t('page.billing.refunds.reasonHint')" html-for="refund-review-reason">
            <Textarea id="refund-review-reason" v-model:value="reviewForm.reason" :rows="3" :maxlength="500" :disabled="locked" />
          </FormItem>
          <Button type="primary" html-type="submit" :danger="!reviewForm.approve" :loading="write.busy.value" :disabled="!reviewReady || write.uncertain.value">{{ t(reviewForm.approve ? 'page.billing.refunds.confirmApprove' : 'page.billing.refunds.confirmReject') }}</Button>
        </Form>

        <Form v-else-if="selected.state === 'awaiting_manual' && !success" layout="vertical" @submit.prevent="submitManual">
          <p class="text-muted-foreground text-sm">{{ t('page.billing.refunds.manualIntro') }}</p>
          <FormItem :label="t('page.billing.refunds.payout')">
            <RadioGroup v-model:value="manualForm.succeeded" :disabled="locked">
              <Radio :value="true">{{ t('page.billing.refunds.paid') }}</Radio>
              <Radio :value="false">{{ t('page.billing.refunds.notPaid') }}</Radio>
            </RadioGroup>
          </FormItem>
          <FormItem :label="t('page.billing.refunds.paymentChannel')" required :extra="t('page.billing.refunds.paymentChannelHint')" html-for="refund-payment-channel">
            <Input id="refund-payment-channel" v-model:value="manualForm.channel" :maxlength="128" :disabled="locked" autocomplete="off" />
          </FormItem>
          <FormItem v-if="manualForm.succeeded" :label="t('page.billing.refunds.paymentReference')" required html-for="refund-payment-reference">
            <Input id="refund-payment-reference" v-model:value="manualForm.reference" :maxlength="256" :disabled="locked" autocomplete="off" />
          </FormItem>
          <FormItem :label="t('page.common.reason')" :required="!manualForm.succeeded" html-for="refund-manual-reason">
            <Textarea id="refund-manual-reason" v-model:value="manualForm.reason" :rows="2" :maxlength="500" :disabled="locked" />
          </FormItem>
          <Button type="primary" html-type="submit" :loading="write.busy.value" :disabled="!manualReady || write.uncertain.value">{{ t('page.billing.refunds.record') }}</Button>
        </Form>

        <PaymentReview v-else-if="selected.state === 'needs_review' && !success" :order="selected" :target="selected.target" @done="(result, action) => done(selected!, result, `review.${action}`)" />

        <MutationAlert :busy="write.busy.value" :error="write.error.value" :uncertain="write.uncertain.value" :success="success" @retry="retry" />
      </div>
    </Drawer>
  </AdminPage>
</template>
