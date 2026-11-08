<script setup lang="ts">
import type { Account, Order, PurchaseRefundInput, Rule, Target } from './api';

import { computed, reactive, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, DatePicker, Descriptions, DescriptionsItem, Form, FormItem, Input, Modal, Radio, RadioGroup, Select, Table, TabPane, Tabs, Tag, Textarea } from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { purchaseRefundReasons, useBillingAdmin } from './api';
import { useMoney } from './money';

/**
 * One account's wallet, orders and ledger, with the account-level actions:
 * refunding a points purchase, granting a reward by rule and revoking a reward.
 * Every read is audited by the server.
 */
const { t } = useI18n();
const format = useFormat();
const money = useMoney();
const errorText = useErrorText();
const api = useBillingAdmin();

const query = reactive({ issuer: '', subject: '' });
const target = shallowRef<Target>();
const account = shallowRef<Account>();
const orders = ref<Order[]>([]);
const ledger = ref<Account['ledger']['items']>([]);
const cursors = reactive({ orders: '', ledger: '' });
const loading = ref(false);
const loadError = ref('');

async function lookup() {
  const next = { issuer: query.issuer.trim(), subject: query.subject.trim() };
  if (!next.issuer || !next.subject || loading.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await api.account(next);
    target.value = next;
    show(result, false, false);
  } catch (error) {
    account.value = undefined;
    loadError.value = errorCode(error);
  } finally {
    loading.value = false;
  }
}
function show(result: Account, appendOrders: boolean, appendLedger: boolean) {
  account.value = result;
  orders.value = appendOrders ? [...orders.value, ...result.orders.items] : result.orders.items;
  ledger.value = appendLedger ? [...ledger.value, ...result.ledger.items] : result.ledger.items;
  cursors.orders = result.orders.next;
  cursors.ledger = result.ledger.next;
}
async function more(kind: 'ledger' | 'orders') {
  if (!target.value || loading.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    // Each page request reads the other list's first page again; only the requested list grows.
    const result = await api.account(target.value, { [kind]: cursors[kind] });
    const keep = { ledger: ledger.value, orders: orders.value, other: kind === 'orders' ? cursors.ledger : cursors.orders };
    show(result, kind === 'orders', kind === 'ledger');
    if (kind === 'orders') {
      ledger.value = keep.ledger;
      cursors.ledger = keep.other;
    } else {
      orders.value = keep.orders;
      cursors.orders = keep.other;
    }
  } catch (error) {
    loadError.value = errorCode(error);
  } finally {
    loading.value = false;
  }
}
async function refresh() {
  if (target.value) {
    const result = await api.account(target.value).catch((error: unknown) => {
      loadError.value = errorCode(error);
    });
    if (result) show(result, false, false);
  }
}

// Account actions share one mutation so a lost response is retried as the same request.
const write = useMutation();
const success = ref('');
const locked = computed(() => write.busy.value || write.uncertain.value);
useLeaveGuard(() => (write.uncertain.value ? t('page.common.leaveUncertain') : (write.busy.value ? t('page.common.leaveUnsaved') : '')));
async function after(result: unknown, message: string) {
  if (result === undefined) return;
  success.value = message;
  await refresh();
}

const refunding = shallowRef<Order>();
const refundReason = ref<PurchaseRefundInput['reason']>('duplicate_charge');
async function refundPurchase() {
  const order = refunding.value;
  if (!order || !target.value) return;
  success.value = '';
  const body: PurchaseRefundInput = { target: target.value, purchase_id: order.id, reason: refundReason.value };
  const result = await write.run(`purchase-refund:${order.id}`, body, (value, key) => api.purchaseRefund(value, key));
  if (result) refunding.value = undefined;
  await after(result, t('page.billing.accounts.refunded'));
}

const rules = shallowRef<Rule[]>([]);
const rulesError = ref('');
async function loadRules() {
  if (rules.value.length > 0) return;
  try {
    rules.value = await api.rules();
  } catch (error) {
    rulesError.value = errorCode(error);
  }
}
const grantForm = reactive({ rule: '', object: '', event: crypto.randomUUID(), occurred: new Date().toISOString() });
const grantRule = computed(() => rules.value.find((item) => item.id === grantForm.rule));
const grantReady = computed(() => !!grantRule.value && !!grantForm.event.trim() && !!grantForm.occurred && (!grantRule.value.object_scoped || !!grantForm.object.trim()));
async function grant() {
  if (!target.value || !grantReady.value) return;
  success.value = '';
  const body = { target: target.value, event: { event_id: grantForm.event.trim(), rule_id: grantForm.rule, object_id: grantForm.object.trim(), occurred_at: grantForm.occurred } };
  const result = await write.run(`grant:${body.event.event_id}`, body, (value, key) => api.grant(value, key));
  if (result) grantForm.event = crypto.randomUUID();
  await after(result, result ? t(`page.billing.accounts.rewardState.${result.state}`) : '');
}
const revokeForm = reactive({ event: '', reason: '' });
async function revoke() {
  if (!target.value || !revokeForm.event.trim() || !revokeForm.reason.trim()) return;
  success.value = '';
  const body = { target: target.value, event_id: revokeForm.event.trim(), reason: revokeForm.reason.trim() };
  const result = await write.run(`revoke:${body.event_id}`, body, (value, key) => api.revoke(value, key));
  if (result) Object.assign(revokeForm, { event: '', reason: '' });
  await after(result, t('page.billing.accounts.revoked'));
}
async function retry() {
  const result = await write.retry();
  // The retried request is the original one; a purchase refund closes its dialog.
  if (result !== undefined) refunding.value = undefined;
  await after(result, t('page.billing.accounts.recorded'));
}

const orderColumns = computed(() => [
  { key: 'created', title: t('page.common.createdAt') },
  { key: 'kind', title: t('page.billing.orderKind') },
  { key: 'amount', title: t('page.billing.amount') },
  { key: 'state', title: t('page.common.status') },
  { key: 'action', title: t('page.common.operation') },
]);
const ledgerColumns = computed(() => [
  { key: 'created', title: t('page.common.createdAt') },
  { key: 'kind', title: t('page.billing.entryKind') },
  { key: 'amount', title: t('page.billing.amount') },
  { key: 'reference', title: t('page.billing.reference') },
]);
const signed = (entry: Account['ledger']['items'][number]) => (entry.asset === 'points' ? money.points(entry.amount) : money.ivory(entry.amount));
</script>

<template>
  <AdminPage :title="t('page.billing.accounts.title')" :description="t('page.billing.accounts.intro')">
    <div class="flex flex-col gap-4">
      <Card :bordered="false">
        <Form layout="vertical" class="max-w-2xl" @submit.prevent="lookup">
          <FormItem :label="t('page.billing.issuer')" html-for="billing-issuer"><Input id="billing-issuer" v-model:value="query.issuer" :maxlength="512" autocomplete="off" /></FormItem>
          <FormItem :label="t('page.billing.subject')" :extra="t('page.billing.accounts.subjectHint')" html-for="billing-subject"><Input id="billing-subject" v-model:value="query.subject" :maxlength="512" autocomplete="off" /></FormItem>
          <Button type="primary" html-type="submit" :loading="loading" :disabled="!query.issuer.trim() || !query.subject.trim()">{{ t('page.common.search') }}</Button>
        </Form>
      </Card>
      <Alert v-if="loadError" type="error" show-icon role="alert" :message="errorText(loadError)" />
      <template v-if="account && target">
        <Card :bordered="false" :title="t('page.billing.accounts.wallet')">
          <Alert v-if="account.wallet.frozen" class="mb-4" type="warning" show-icon :message="t('page.billing.accounts.frozen')" />
          <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
            <DescriptionsItem :label="t('page.billing.accounts.points')">{{ money.points(account.wallet.points) }}</DescriptionsItem>
            <DescriptionsItem :label="t('page.billing.accounts.debt')">{{ money.points(account.wallet.debt_points) }}</DescriptionsItem>
            <DescriptionsItem :label="t('page.billing.accounts.ivory')">{{ money.ivory(account.wallet.ivory_minor) }}</DescriptionsItem>
            <DescriptionsItem :label="t('page.billing.accounts.frozenIvory')">{{ money.ivory(account.wallet.frozen_ivory_minor) }}</DescriptionsItem>
          </Descriptions>
        </Card>
        <MutationAlert :busy="write.busy.value" :error="write.error.value" :uncertain="write.uncertain.value" :success="success" @retry="retry" />
        <Card :bordered="false">
          <Tabs @change="(key) => key === 'grant' && loadRules()">
            <TabPane key="orders" :tab="t('page.billing.accounts.orders')">
              <Table :columns="orderColumns" :data-source="orders" :pagination="false" row-key="id" size="small" :scroll="{ x: 640 }" :locale="{ emptyText: t('page.common.empty') }">
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'created'">{{ format.dateTime(record.created_at) }}</template>
                  <template v-else-if="column.key === 'kind'">{{ t(`page.billing.kind.${record.kind}`) }}</template>
                  <template v-else-if="column.key === 'amount'">{{ money.order(record as Order) }}</template>
                  <template v-else-if="column.key === 'state'"><Tag>{{ t(`page.billing.orderState.${record.state}`) }}</Tag></template>
                  <template v-else-if="column.key === 'action'">
                    <Button v-if="record.kind === 'purchase' && record.state === 'succeeded'" type="link" size="small" :disabled="locked" @click="refunding = record as Order">{{ t('page.billing.accounts.refundPurchase') }}</Button>
                  </template>
                </template>
              </Table>
              <div class="mt-3 flex justify-center"><Button v-if="cursors.orders" :loading="loading" @click="more('orders')">{{ t('page.common.loadMore') }}</Button></div>
            </TabPane>
            <TabPane key="ledger" :tab="t('page.billing.accounts.ledger')">
              <Table :columns="ledgerColumns" :data-source="ledger" :pagination="false" row-key="id" size="small" :scroll="{ x: 560 }" :locale="{ emptyText: t('page.common.empty') }">
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'created'">{{ format.dateTime(record.created_at) }}</template>
                  <template v-else-if="column.key === 'kind'"><code class="text-xs">{{ record.kind }}</code></template>
                  <template v-else-if="column.key === 'amount'">{{ signed(record as Account['ledger']['items'][number]) }}</template>
                  <template v-else-if="column.key === 'reference'"><code class="break-all text-xs">{{ record.reference }}</code></template>
                </template>
              </Table>
              <div class="mt-3 flex justify-center"><Button v-if="cursors.ledger" :loading="loading" @click="more('ledger')">{{ t('page.common.loadMore') }}</Button></div>
            </TabPane>
            <TabPane key="grant" :tab="t('page.billing.accounts.grant')">
              <Alert v-if="rulesError" class="mb-4" type="error" show-icon :message="errorText(rulesError)" />
              <Form layout="vertical" class="max-w-2xl" @submit.prevent="grant">
                <FormItem :label="t('page.billing.accounts.rule')" required html-for="billing-grant-rule">
                  <Select id="billing-grant-rule" v-model:value="grantForm.rule" :disabled="locked" :options="rules.map((rule) => ({ value: rule.id, label: `${rule.id} · ${money.points(rule.points)}`, disabled: !rule.enabled }))" />
                </FormItem>
                <FormItem v-if="grantRule?.object_scoped" :label="t('page.billing.accounts.object')" required :extra="t('page.billing.accounts.objectHint')" html-for="billing-grant-object">
                  <Input id="billing-grant-object" v-model:value="grantForm.object" :maxlength="256" :disabled="locked" />
                </FormItem>
                <FormItem :label="t('page.billing.accounts.event')" :extra="t('page.billing.accounts.eventHint')" html-for="billing-grant-event">
                  <Input id="billing-grant-event" v-model:value="grantForm.event" :maxlength="256" :disabled="locked" />
                </FormItem>
                <FormItem :label="t('page.billing.accounts.occurred')" html-for="billing-grant-occurred">
                  <DatePicker id="billing-grant-occurred" v-model:value="grantForm.occurred" show-time value-format="YYYY-MM-DDTHH:mm:ssZ" :allow-clear="false" :disabled="locked" />
                </FormItem>
                <Button type="primary" html-type="submit" :loading="write.busy.value" :disabled="!grantReady || write.uncertain.value">{{ t('page.billing.accounts.grantSubmit') }}</Button>
              </Form>
            </TabPane>
            <TabPane key="revoke" :tab="t('page.billing.accounts.revoke')">
              <p class="text-muted-foreground mb-3 text-sm">{{ t('page.billing.accounts.revokeHint') }}</p>
              <Form layout="vertical" class="max-w-2xl" @submit.prevent="revoke">
                <FormItem :label="t('page.billing.accounts.event')" required html-for="billing-revoke-event"><Input id="billing-revoke-event" v-model:value="revokeForm.event" :maxlength="256" :disabled="locked" /></FormItem>
                <FormItem :label="t('page.common.reason')" required html-for="billing-revoke-reason"><Textarea id="billing-revoke-reason" v-model:value="revokeForm.reason" :rows="2" :maxlength="500" :disabled="locked" /></FormItem>
                <Button danger type="primary" html-type="submit" :loading="write.busy.value" :disabled="!revokeForm.event.trim() || !revokeForm.reason.trim() || write.uncertain.value">{{ t('page.billing.accounts.revokeSubmit') }}</Button>
              </Form>
            </TabPane>
          </Tabs>
        </Card>
      </template>
    </div>

    <Modal :open="!!refunding" :title="t('page.billing.accounts.refundPurchase')" :footer="null" :mask-closable="false" @cancel="!locked && (refunding = undefined)">
      <template v-if="refunding">
        <p class="mb-3">{{ t('page.billing.accounts.refundSummary', { amount: money.order(refunding) }) }}</p>
        <Form layout="vertical" @submit.prevent="refundPurchase">
          <FormItem :label="t('page.common.reason')">
            <RadioGroup v-model:value="refundReason" :disabled="locked">
              <Radio v-for="reason in purchaseRefundReasons" :key="reason" :value="reason">{{ t(`page.billing.accounts.refundReason.${reason}`) }}</Radio>
            </RadioGroup>
          </FormItem>
          <MutationAlert :busy="write.busy.value" :error="write.error.value" :uncertain="write.uncertain.value" @retry="retry" />
          <div class="mt-4 flex gap-2">
            <Button type="primary" html-type="submit" :loading="write.busy.value" :disabled="write.uncertain.value">{{ t('page.billing.accounts.confirmRefund') }}</Button>
            <Button :disabled="locked" @click="refunding = undefined">{{ t('page.common.cancel') }}</Button>
          </div>
        </Form>
      </template>
    </Modal>
  </AdminPage>
</template>
