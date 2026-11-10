<script setup lang="ts">
import type { Channel, Offer, Rule } from './api';

import { computed, onMounted, reactive, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Checkbox, Drawer, Form, FormItem, Input, InputNumber, Switch, Table, Tag } from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { minorText, parseMinor, useBillingAdmin } from './api';
import { useMoney } from './money';

/**
 * Payment channels, points offers and reward rules, including disabled ones.
 * Offers and rules carry a version: saving sends the version that was read and
 * the server rejects the save when someone changed it meanwhile. A rule change
 * applies from the moment it is saved.
 */
type Kind = 'channel' | 'offer' | 'rule';
const { t } = useI18n();
const format = useFormat();
const money = useMoney();
const api = useBillingAdmin();
const day = 86_400;

const status = ref<'error' | 'loading' | 'ready'>('loading');
const loadError = ref('');
const channels = shallowRef<Channel[]>([]);
const offers = shallowRef<Offer[]>([]);
const rules = shallowRef<Rule[]>([]);
async function load() {
  status.value = 'loading';
  loadError.value = '';
  try {
    [channels.value, offers.value, rules.value] = await Promise.all([api.channels(), api.offers(), api.rules()]);
    status.value = 'ready';
  } catch (error) {
    loadError.value = errorCode(error);
    status.value = 'error';
  }
}
onMounted(load);

// One drawer edits any of the three kinds; amounts are typed in yuan and days.
const editing = ref<Kind>();
const isNew = ref(false);
const form = reactive({ id: '', enabled: true, amounts: '', originalRefunds: true, amount: '', points: 0, validDays: 0, periodDays: 1, limit: 1, objectScoped: false, version: 0 });
const baseline = ref('');
const write = useMutation();
const success = ref('');
const locked = computed(() => write.busy.value || write.uncertain.value);
const dirty = computed(() => !!editing.value && JSON.stringify(form) !== baseline.value);
useLeaveGuard(() => (write.uncertain.value ? t('page.common.leaveUncertain') : (dirty.value || write.busy.value ? t('page.common.leaveUnsaved') : '')));

function edit(kind: Kind, item?: Channel | Offer | Rule) {
  editing.value = kind;
  isNew.value = !item;
  success.value = '';
  write.dismiss();
  Object.assign(form, { id: '', enabled: true, amounts: '', originalRefunds: true, amount: '', points: 0, validDays: 0, periodDays: 1, limit: 1, objectScoped: false, version: 0 });
  if (kind === 'channel' && item) {
    const channel = item as Channel;
    Object.assign(form, { id: channel.id, enabled: channel.enabled, amounts: channel.amounts_minor.map((value) => minorText(value)).join(', '), originalRefunds: channel.original_refunds });
  } else if (kind === 'offer' && item) {
    const offer = item as Offer;
    Object.assign(form, { id: offer.id, enabled: offer.enabled, amount: minorText(offer.amount_minor), points: offer.points, validDays: offer.valid_seconds / day, version: offer.version });
  } else if (kind === 'rule' && item) {
    const rule = item as Rule;
    Object.assign(form, { id: rule.id, enabled: rule.enabled, points: rule.points, validDays: rule.valid_seconds / day, periodDays: rule.period_seconds / day, limit: rule.limit, objectScoped: rule.object_scoped, version: rule.version });
  }
  baseline.value = JSON.stringify(form);
}
function close() {
  if (!locked.value) editing.value = undefined;
}

const amounts = computed(() => {
  const parts = form.amounts.split(/[,，\s]+/u).filter(Boolean);
  const values = parts.map((part) => parseMinor(part));
  return values.every((value) => value !== undefined && value > 0) && values.length > 0 && values.length <= 100 && new Set(values).size === values.length ? (values as number[]) : undefined;
});
const offerAmount = computed(() => parseMinor(form.amount));
const idValid = computed(() => /^[\w.-]{1,128}$/u.test(form.id));
const ready = computed(() => {
  if (!idValid.value) return false;
  if (editing.value === 'channel') return !!amounts.value;
  if (editing.value === 'offer') return !!offerAmount.value && form.points > 0;
  return form.points > 0 && form.periodDays >= 1 && form.limit >= 1;
});

async function save() {
  const kind = editing.value;
  if (!kind || !ready.value) return;
  let result: Channel | Offer | Rule | undefined;
  if (kind === 'channel') {
    const body: Channel = { id: form.id, enabled: form.enabled, amounts_minor: amounts.value ?? [], original_refunds: form.originalRefunds };
    result = await write.run(`channel:${body.id}`, body, (value, key) => api.saveChannel(value, key));
  } else if (kind === 'offer') {
    const body: Offer = { id: form.id, enabled: form.enabled, amount_minor: offerAmount.value ?? 0, points: form.points, valid_seconds: Math.round(form.validDays * day), version: form.version };
    result = await write.run(`offer:${body.id}:${body.version}`, body, (value, key) => api.saveOffer(value, key));
  } else {
    // The server sets effective_at to the save time; the value sent is the one that was read.
    const current = rules.value.find((rule) => rule.id === form.id);
    const body: Rule = { id: form.id, enabled: form.enabled, points: form.points, valid_seconds: Math.round(form.validDays * day), period_seconds: Math.round(form.periodDays * day), limit: form.limit, object_scoped: form.objectScoped, version: form.version, effective_at: current?.effective_at ?? new Date().toISOString() };
    result = await write.run(`rule:${body.id}:${body.version}`, body, (value, key) => api.saveRule(value, key));
  }
  if (result) saved(kind, result);
}
async function retry() {
  const kind = editing.value;
  const result = (await write.retry()) as Channel | Offer | Rule | undefined;
  if (kind && result) saved(kind, result);
}
function saved(kind: Kind, result: Channel | Offer | Rule) {
  const replace = <T extends { id: string }>(list: T[], item: T) => (list.some((entry) => entry.id === item.id) ? list.map((entry) => (entry.id === item.id ? item : entry)) : [...list, item]);
  if (kind === 'channel') channels.value = replace(channels.value, result as Channel);
  else if (kind === 'offer') offers.value = replace(offers.value, result as Offer);
  else rules.value = replace(rules.value, result as Rule);
  if ('version' in result) form.version = result.version;
  isNew.value = false;
  baseline.value = JSON.stringify(form);
  success.value = t('page.common.saved');
}

const days = (seconds: number) => (seconds ? t('page.billing.config.days', { days: format.value.number(seconds / day, { maximumFractionDigits: 2 }) }) : t('page.billing.config.noExpiry'));
const channelColumns = computed(() => [
  { key: 'id', title: t('page.billing.config.id') },
  { key: 'enabled', title: t('page.common.status') },
  { key: 'amounts', title: t('page.billing.config.amounts') },
  { key: 'refunds', title: t('page.billing.config.originalRefunds') },
  { key: 'action', title: t('page.common.operation') },
]);
const offerColumns = computed(() => [
  { key: 'id', title: t('page.billing.config.id') },
  { key: 'enabled', title: t('page.common.status') },
  { key: 'price', title: t('page.billing.config.price') },
  { key: 'points', title: t('page.billing.config.points') },
  { key: 'valid', title: t('page.billing.config.validity') },
  { key: 'version', title: t('page.common.revision') },
  { key: 'action', title: t('page.common.operation') },
]);
const ruleColumns = computed(() => [
  { key: 'id', title: t('page.billing.config.id') },
  { key: 'enabled', title: t('page.common.status') },
  { key: 'points', title: t('page.billing.config.points') },
  { key: 'limit', title: t('page.billing.config.limitColumn') },
  { key: 'valid', title: t('page.billing.config.validity') },
  { key: 'effective', title: t('page.billing.config.effective') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage :title="t('page.billing.config.title')" :description="t('page.billing.config.intro')">
    <Card v-if="status !== 'ready'" :bordered="false">
      <LoadState :status="status" :error="loadError" @retry="load" />
    </Card>
    <div v-else class="flex flex-col gap-4">
        <Card :bordered="false" :title="t('page.billing.config.channels')">
          <Button class="mb-3" @click="edit('channel')">{{ t('page.billing.config.newChannel') }}</Button>
          <Table :columns="channelColumns" :data-source="channels" :pagination="false" row-key="id" size="middle" :scroll="{ x: 640 }" :locale="{ emptyText: t('page.common.empty') }">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'id'"><code>{{ record.id }}</code></template>
              <template v-else-if="column.key === 'enabled'"><Tag :color="record.enabled ? 'green' : undefined">{{ t(record.enabled ? 'page.billing.config.enabled' : 'page.billing.config.disabled') }}</Tag></template>
              <template v-else-if="column.key === 'amounts'">{{ format.list(record.amounts_minor.map((value: number) => money.cny(value))) }}</template>
              <template v-else-if="column.key === 'refunds'">{{ t(record.original_refunds ? 'page.billing.config.yes' : 'page.billing.config.no') }}</template>
              <template v-else-if="column.key === 'action'"><Button type="link" size="small" @click="edit('channel', record as Channel)">{{ t('page.common.edit') }}</Button></template>
            </template>
          </Table>
        </Card>
        <Card :bordered="false" :title="t('page.billing.config.offers')">
          <Button class="mb-3" @click="edit('offer')">{{ t('page.billing.config.newOffer') }}</Button>
          <Table :columns="offerColumns" :data-source="offers" :pagination="false" row-key="id" size="middle" :scroll="{ x: 720 }" :locale="{ emptyText: t('page.common.empty') }">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'id'"><code>{{ record.id }}</code></template>
              <template v-else-if="column.key === 'enabled'"><Tag :color="record.enabled ? 'green' : undefined">{{ t(record.enabled ? 'page.billing.config.enabled' : 'page.billing.config.disabled') }}</Tag></template>
              <template v-else-if="column.key === 'price'">{{ money.ivory(record.amount_minor) }}</template>
              <template v-else-if="column.key === 'points'">{{ money.points(record.points) }}</template>
              <template v-else-if="column.key === 'valid'">{{ days(record.valid_seconds) }}</template>
              <template v-else-if="column.key === 'version'">{{ format.number(record.version) }}</template>
              <template v-else-if="column.key === 'action'"><Button type="link" size="small" @click="edit('offer', record as Offer)">{{ t('page.common.edit') }}</Button></template>
            </template>
          </Table>
        </Card>
        <Card :bordered="false" :title="t('page.billing.config.rules')">
          <Button class="mb-3" @click="edit('rule')">{{ t('page.billing.config.newRule') }}</Button>
          <Table :columns="ruleColumns" :data-source="rules" :pagination="false" row-key="id" size="middle" :scroll="{ x: 760 }" :locale="{ emptyText: t('page.common.empty') }">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'id'"><code>{{ record.id }}</code></template>
              <template v-else-if="column.key === 'enabled'"><Tag :color="record.enabled ? 'green' : undefined">{{ t(record.enabled ? 'page.billing.config.enabled' : 'page.billing.config.disabled') }}</Tag></template>
              <template v-else-if="column.key === 'points'">{{ money.points(record.points) }}</template>
              <template v-else-if="column.key === 'limit'">{{ t('page.billing.config.limitText', { limit: format.number(record.limit), period: days(record.period_seconds) }) }}<template v-if="record.object_scoped"> · {{ t('page.billing.config.perObject') }}</template></template>
              <template v-else-if="column.key === 'valid'">{{ days(record.valid_seconds) }}</template>
              <template v-else-if="column.key === 'effective'">{{ format.dateTime(record.effective_at) }}</template>
              <template v-else-if="column.key === 'action'"><Button type="link" size="small" @click="edit('rule', record as Rule)">{{ t('page.common.edit') }}</Button></template>
            </template>
          </Table>
        </Card>
    </div>

    <Drawer :open="!!editing" :width="560" :title="editing ? t(`page.billing.config.edit.${editing}`) : ''" :mask-closable="false" destroy-on-close @close="close">
      <Form v-if="editing" layout="vertical" @submit.prevent="save">
        <FormItem :label="t('page.billing.config.id')" required :extra="t('page.billing.config.idHint')" html-for="billing-config-id">
          <Input id="billing-config-id" v-model:value="form.id" :maxlength="128" :disabled="!isNew || locked" autocomplete="off" />
        </FormItem>
        <FormItem>
          <Checkbox v-model:checked="form.enabled" :disabled="locked">{{ t('page.billing.config.enabled') }}</Checkbox>
        </FormItem>
        <template v-if="editing === 'channel'">
          <FormItem :label="t('page.billing.config.amounts')" required :extra="t('page.billing.config.amountsHint')" html-for="billing-config-amounts">
            <Input id="billing-config-amounts" v-model:value="form.amounts" :disabled="locked" autocomplete="off" />
          </FormItem>
          <FormItem :label="t('page.billing.config.originalRefunds')" :extra="t('page.billing.config.originalRefundsHint')" html-for="billing-config-refunds">
            <Switch id="billing-config-refunds" v-model:checked="form.originalRefunds" :disabled="locked" />
          </FormItem>
        </template>
        <FormItem v-if="editing === 'offer'" :label="t('page.billing.config.price')" required :extra="t('page.billing.config.priceHint')" html-for="billing-config-price">
          <Input id="billing-config-price" v-model:value="form.amount" :disabled="locked" inputmode="decimal" autocomplete="off" />
        </FormItem>
        <template v-if="editing !== 'channel'">
          <FormItem :label="t('page.billing.config.points')" required html-for="billing-config-points">
            <InputNumber id="billing-config-points" v-model:value="form.points" :min="1" :precision="0" :disabled="locked" />
          </FormItem>
          <FormItem :label="t('page.billing.config.validDays')" :extra="t('page.billing.config.validDaysHint')" html-for="billing-config-valid">
            <InputNumber id="billing-config-valid" v-model:value="form.validDays" :min="0" :max="3652" :precision="0" :disabled="locked" />
          </FormItem>
        </template>
        <template v-if="editing === 'rule'">
          <FormItem :label="t('page.billing.config.periodDays')" required html-for="billing-config-period">
            <InputNumber id="billing-config-period" v-model:value="form.periodDays" :min="1" :max="3652" :precision="0" :disabled="locked" />
          </FormItem>
          <FormItem :label="t('page.billing.config.limit')" required :extra="t('page.billing.config.limitHint')" html-for="billing-config-limit">
            <InputNumber id="billing-config-limit" v-model:value="form.limit" :min="1" :precision="0" :disabled="locked" />
          </FormItem>
          <FormItem :extra="t('page.billing.config.perObjectHint')">
            <Checkbox v-model:checked="form.objectScoped" :disabled="locked">{{ t('page.billing.config.perObject') }}</Checkbox>
          </FormItem>
          <Alert class="mb-4" type="info" show-icon :message="t('page.billing.config.ruleNotice')" />
        </template>
        <MutationAlert :busy="write.busy.value" :error="write.error.value" :uncertain="write.uncertain.value" :success="success" @retry="retry" />
        <div class="mt-4 flex gap-2">
          <Button type="primary" html-type="submit" :loading="write.busy.value" :disabled="!ready || !dirty || write.uncertain.value">{{ t('page.common.save') }}</Button>
          <Button v-if="write.error.value === 'billing_conflict'" :disabled="locked" @click="load(); editing = undefined">{{ t('page.common.reloadCompare') }}</Button>
        </div>
      </Form>
    </Drawer>
  </AdminPage>
</template>
