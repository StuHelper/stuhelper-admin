<script setup lang="ts">
import type { MembershipPlan } from './api';

import type { Category, Coverage, CoverageRule } from '#/features/resources/api';

import { computed, onMounted, reactive, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Checkbox, Drawer, Form, FormItem, Input, InputNumber, Popconfirm, Select, Table, Tag, TreeSelect } from 'ant-design-vue';

import { useCampus } from '#/features/academic/campus';
import { localName, useResourcesApi } from '#/features/resources/api';
import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { minorText, parseMinor, useBillingAdmin } from './api';
import { useMoney } from './money';

/**
 * Membership plans and the resources each plan covers. Billing owns the plan's
 * name, period and prices; the resources module owns its coverage. A plan
 * without coverage cannot be bought, so the table shows both side by side.
 * Both writes send the version or revision that was read, and a concurrent
 * change is rejected instead of overwritten.
 */
const { locale, t } = useI18n();
const format = useFormat();
const money = useMoney();
const errorText = useErrorText();
const billing = useBillingAdmin();
const resources = useResourcesApi();
const campus = useCampus();
const day = 86_400;

const status = ref<'error' | 'loading' | 'ready'>('loading');
const loadError = ref('');
const plans = shallowRef<MembershipPlan[]>([]);
// Coverage per plan: null when the plan has none configured, a code when the read failed.
const coverage = shallowRef(new Map<string, Coverage | null | string>());
async function load() {
  status.value = 'loading';
  loadError.value = '';
  try {
    plans.value = await billing.plans();
    status.value = 'ready';
  } catch (error) {
    loadError.value = errorCode(error);
    status.value = 'error';
    return;
  }
  const next = new Map<string, Coverage | null | string>();
  await Promise.all(plans.value.map(async (plan) => {
    try {
      next.set(plan.id, await resources.coverage(plan.id));
    } catch (error) {
      next.set(plan.id, errorCode(error) === 'not_found' ? null : errorCode(error));
    }
  }));
  coverage.value = next;
}
onMounted(load);

// Plan drawer. Prices are typed as points and yuan-style Ivory; at least one is required.
const editing = ref(false);
const isNew = ref(false);
const form = reactive({ id: '', name: '', days: 30, enabled: true, points: undefined as number | undefined, ivory: '', version: 0 });
const baseline = ref('');
const write = useMutation();
const success = ref('');
const locked = computed(() => write.busy.value || write.uncertain.value);
const dirty = computed(() => editing.value && JSON.stringify(form) !== baseline.value);

function edit(plan?: MembershipPlan) {
  editing.value = true;
  isNew.value = !plan;
  success.value = '';
  write.dismiss();
  Object.assign(form, plan
    ? { id: plan.id, name: plan.name, days: Math.round(plan.valid_seconds / day), enabled: plan.enabled, points: plan.points ?? undefined, ivory: plan.ivory_minor ? minorText(plan.ivory_minor) : '', version: plan.version }
    : { id: '', name: '', days: 30, enabled: true, points: undefined, ivory: '', version: 0 });
  baseline.value = JSON.stringify(form);
}
function close() {
  if (!locked.value) editing.value = false;
}
const ivory = computed(() => (form.ivory.trim() ? parseMinor(form.ivory) : null));
const ready = computed(() => /^[\w.-]{1,128}$/u.test(form.id) && !!form.name.trim() && form.days >= 1 && ivory.value !== undefined && ivory.value !== 0 && (!!form.points || !!ivory.value));
async function save() {
  if (!ready.value) return;
  const body: MembershipPlan = { id: form.id, name: form.name.trim(), valid_seconds: form.days * day, enabled: form.enabled, points: form.points || null, ivory_minor: ivory.value ?? null, version: form.version };
  const result = await write.run(`plan:${body.id}:${body.version}`, body, (value, key) => billing.savePlan(value, key));
  if (result) savedPlan(result);
}
function savedPlan(result: MembershipPlan) {
  plans.value = plans.value.some((plan) => plan.id === result.id) ? plans.value.map((plan) => (plan.id === result.id ? result : plan)) : [...plans.value, result];
  if (!coverage.value.has(result.id)) coverage.value = new Map(coverage.value).set(result.id, null);
  form.version = result.version;
  isNew.value = false;
  baseline.value = JSON.stringify(form);
  success.value = t('page.common.saved');
}

// Stopping sales keeps the plan's terms and orders; memberships already bought keep their period.
const removal = useMutation();
async function stop(plan: MembershipPlan) {
  const result = await removal.run(`plan-delete:${plan.id}:${plan.version}`, plan.id, (id, key) => billing.deletePlan(id, key));
  if (result) await load();
}
async function retryStop() {
  if (await removal.retry()) await load();
}

// Coverage drawer. The served school is fixed; each rule may narrow it to one
// folder (exactly that folder, not its subfolders) and/or one category.
type RuleRow = { category?: string; directory?: string; school: string };
const covering = shallowRef<MembershipPlan>();
const rows = ref<RuleRow[]>([]);
const revision = ref(0);
const coverBaseline = ref('');
const cover = useMutation();
const coverSuccess = ref('');
const coverLocked = computed(() => cover.busy.value || cover.uncertain.value);
const coverDirty = computed(() => !!covering.value && JSON.stringify(rows.value) !== coverBaseline.value);
const categories = shallowRef<Category[]>([]);
type Node = { children?: Node[]; title: string; value: string };
const tree = shallowRef<Node[]>([]);
const optionsError = ref('');

async function openCoverage(plan: MembershipPlan) {
  covering.value = plan;
  coverSuccess.value = '';
  cover.dismiss();
  const current = coverage.value.get(plan.id);
  const known = current && typeof current === 'object' ? current : undefined;
  revision.value = known?.revision ?? 0;
  rows.value = (known?.rules ?? []).map((rule) => ({ school: rule.school_id, directory: rule.directory_id, category: rule.category_id }));
  coverBaseline.value = JSON.stringify(rows.value);
  await loadOptions();
}
async function loadOptions() {
  optionsError.value = '';
  try {
    if (campus.status.value !== 'ready') await campus.load();
    const [list, folders] = await Promise.all([resources.categories(undefined, true), folderTree(campus.id.value)]);
    categories.value = list;
    tree.value = folders;
  } catch (error) {
    optionsError.value = errorCode(error);
  }
}
// Folders are read level by level; at most 1000 are listed so a large tree stays bounded.
async function folderTree(school: string) {
  let budget = 1000;
  async function level(parent?: string): Promise<Node[]> {
    const page = await resources.directories({ school_id: school, parent_id: parent, limit: 100 });
    const nodes: Node[] = [];
    for (const item of page.items) {
      if (budget-- <= 0) break;
      nodes.push({ value: item.id, title: localName(item.names ?? {}, locale.value) || item.id });
    }
    for (const node of nodes) {
      const children = budget > 0 ? await level(node.value) : [];
      if (children.length > 0) node.children = children;
    }
    return nodes;
  }
  return level();
}
function addRule() {
  rows.value = [...rows.value, { school: campus.id.value }];
}
function removeRule(index: number) {
  rows.value = rows.value.filter((_, at) => at !== index);
}
const coverReady = computed(() => rows.value.length <= 100 && rows.value.every((row) => !!row.school));
async function saveCoverage() {
  const plan = covering.value;
  if (!plan || !coverReady.value) return;
  const rules: CoverageRule[] = rows.value.map((row) => ({ school_id: row.school, ...(row.directory ? { directory_id: row.directory } : {}), ...(row.category ? { category_id: row.category } : {}) }));
  const body: Coverage = { plan_id: plan.id, revision: revision.value, rules };
  const result = await cover.run(`coverage:${plan.id}:${body.revision}`, body, (value, key) => resources.saveCoverage(value, key));
  if (result) savedCoverage(result);
}
async function retryCoverage() {
  const result = (await cover.retry()) as Coverage | undefined;
  if (result) savedCoverage(result);
}
function savedCoverage(result: Coverage) {
  coverage.value = new Map(coverage.value).set(result.plan_id, result);
  revision.value = result.revision;
  coverBaseline.value = JSON.stringify(rows.value);
  coverSuccess.value = t('page.common.saved');
}
function closeCoverage() {
  if (!coverLocked.value) covering.value = undefined;
}

useLeaveGuard(() => {
  if (write.uncertain.value || cover.uncertain.value || removal.uncertain.value) return t('page.common.leaveUncertain');
  return dirty.value || coverDirty.value || write.busy.value || cover.busy.value ? t('page.common.leaveUnsaved') : '';
});

const categoryName = (id: string) => {
  const found = categories.value.find((item) => item.id === id);
  return found ? localName(found.names ?? {}, locale.value) || id : id;
};
const prices = (plan: MembershipPlan) => new Intl.ListFormat(locale.value, { type: 'disjunction' }).format([plan.points ? money.points(plan.points) : '', plan.ivory_minor ? money.ivory(plan.ivory_minor) : ''].filter(Boolean));
const coverageText = (plan: MembershipPlan) => {
  const value = coverage.value.get(plan.id);
  if (value === undefined) return '';
  if (typeof value === 'string') return t('page.billing.memberships.coverageUnavailable');
  if (!value?.rules.length) return t('page.billing.memberships.noCoverage');
  return t('page.billing.memberships.ruleCount', { count: format.value.number(value.rules.length) });
};
const columns = computed(() => [
  { key: 'id', title: t('page.billing.config.id') },
  { key: 'name', dataIndex: 'name', title: t('page.billing.memberships.name') },
  { key: 'enabled', title: t('page.common.status') },
  { key: 'price', title: t('page.billing.config.price') },
  { key: 'valid', title: t('page.billing.config.validity') },
  { key: 'coverage', title: t('page.billing.memberships.coverage') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage :title="t('page.billing.memberships.title')" :description="t('page.billing.memberships.intro')">
    <Card :bordered="false">
      <LoadState v-if="status !== 'ready'" :status="status" :error="loadError" @retry="load" />
      <template v-else>
        <Button class="mb-3" @click="edit()">{{ t('page.billing.memberships.new') }}</Button>
        <MutationAlert class="mb-3" :busy="removal.busy.value" :error="removal.error.value" :uncertain="removal.uncertain.value" @retry="retryStop" />
        <Table :columns="columns" :data-source="plans" :pagination="false" row-key="id" size="middle" :scroll="{ x: 860 }" :locale="{ emptyText: t('page.common.empty') }">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'"><code>{{ record.id }}</code></template>
            <template v-else-if="column.key === 'enabled'"><Tag :color="record.enabled ? 'green' : undefined">{{ t(record.enabled ? 'page.billing.config.enabled' : 'page.billing.config.disabled') }}</Tag></template>
            <template v-else-if="column.key === 'price'">{{ prices(record as MembershipPlan) }}</template>
            <template v-else-if="column.key === 'valid'">{{ t('page.billing.config.days', { days: format.number(Math.round(record.valid_seconds / day)) }) }}</template>
            <template v-else-if="column.key === 'coverage'">
              <Tag :color="coverage.get(record.id) && typeof coverage.get(record.id) === 'object' && (coverage.get(record.id) as Coverage).rules.length > 0 ? 'blue' : 'orange'">{{ coverageText(record as MembershipPlan) }}</Tag>
            </template>
            <template v-else-if="column.key === 'action'">
              <Button type="link" size="small" @click="edit(record as MembershipPlan)">{{ t('page.common.edit') }}</Button>
              <Button type="link" size="small" @click="openCoverage(record as MembershipPlan)">{{ t('page.billing.memberships.editCoverage') }}</Button>
              <Popconfirm v-if="record.enabled" :title="t('page.billing.memberships.stopConfirm')" @confirm="stop(record as MembershipPlan)">
                <Button type="link" size="small" danger :disabled="removal.busy.value || removal.uncertain.value">{{ t('page.billing.memberships.stop') }}</Button>
              </Popconfirm>
            </template>
          </template>
        </Table>
      </template>
    </Card>

    <Drawer :open="editing" :width="560" :title="t(isNew ? 'page.billing.memberships.new' : 'page.billing.memberships.edit')" :mask-closable="false" destroy-on-close @close="close">
      <Form layout="vertical" @submit.prevent="save">
        <FormItem :label="t('page.billing.config.id')" required :extra="t('page.billing.memberships.idHint')" html-for="plan-id">
          <Input id="plan-id" v-model:value="form.id" :maxlength="128" :disabled="!isNew || locked" autocomplete="off" />
        </FormItem>
        <FormItem :label="t('page.billing.memberships.name')" required :extra="t('page.billing.memberships.nameHint')" html-for="plan-name">
          <Input id="plan-name" v-model:value="form.name" :maxlength="128" :disabled="locked" autocomplete="off" />
        </FormItem>
        <FormItem :label="t('page.billing.memberships.days')" required html-for="plan-days">
          <InputNumber id="plan-days" v-model:value="form.days" :min="1" :max="3652" :precision="0" :disabled="locked" />
        </FormItem>
        <FormItem :label="t('page.billing.memberships.pointsPrice')" :extra="t('page.billing.memberships.priceHint')" html-for="plan-points">
          <InputNumber id="plan-points" v-model:value="form.points" :min="1" :precision="0" :disabled="locked" />
        </FormItem>
        <FormItem :label="t('page.billing.memberships.ivoryPrice')" :validate-status="ivory === undefined || ivory === 0 ? 'error' : undefined" :help="ivory === undefined || ivory === 0 ? t('page.billing.memberships.ivoryInvalid') : undefined" html-for="plan-ivory">
          <Input id="plan-ivory" v-model:value="form.ivory" :disabled="locked" inputmode="decimal" autocomplete="off" />
        </FormItem>
        <FormItem>
          <Checkbox v-model:checked="form.enabled" :disabled="locked">{{ t('page.billing.memberships.onSale') }}</Checkbox>
        </FormItem>
        <MutationAlert :busy="write.busy.value" :error="write.error.value" :uncertain="write.uncertain.value" :success="success" @retry="async () => { const result = (await write.retry()) as MembershipPlan | undefined; if (result) savedPlan(result); }" />
        <div class="mt-4 flex gap-2">
          <Button type="primary" html-type="submit" :loading="write.busy.value" :disabled="!ready || !dirty || write.uncertain.value">{{ t('page.common.save') }}</Button>
          <Button v-if="write.error.value === 'billing_conflict'" :disabled="locked" @click="load(); editing = false">{{ t('page.common.reloadCompare') }}</Button>
        </div>
      </Form>
    </Drawer>

    <Drawer :open="!!covering" :width="640" :title="covering ? t('page.billing.memberships.coverageTitle', { name: covering.name }) : ''" :mask-closable="false" destroy-on-close @close="closeCoverage">
      <div v-if="covering" class="flex flex-col gap-3">
        <p class="text-muted-foreground text-sm">{{ t('page.billing.memberships.coverageIntro') }}</p>
        <Alert v-if="optionsError" type="error" show-icon :message="errorText(optionsError)">
          <template #action><Button size="small" @click="loadOptions">{{ t('page.common.retry') }}</Button></template>
        </Alert>
        <p v-if="rows.length === 0" class="text-sm">{{ t('page.billing.memberships.noRules') }}</p>
        <fieldset v-for="(row, index) in rows" :key="index" class="flex flex-wrap items-end gap-2 rounded border p-3">
          <legend class="px-1 text-sm">{{ t('page.billing.memberships.rule', { index: format.number(index + 1) }) }}</legend>
          <label class="flex min-w-48 flex-1 flex-col gap-1 text-sm">
            {{ t('page.billing.memberships.directory') }}
            <TreeSelect v-model:value="row.directory" :tree-data="tree" allow-clear tree-default-expand-all :placeholder="t('page.billing.memberships.anyDirectory')" :disabled="coverLocked" :aria-label="t('page.billing.memberships.directory')" />
          </label>
          <label class="flex min-w-48 flex-1 flex-col gap-1 text-sm">
            {{ t('page.billing.memberships.category') }}
            <Select v-model:value="row.category" allow-clear :placeholder="t('page.billing.memberships.anyCategory')" :options="categories.map((item) => ({ value: item.id, label: categoryName(item.id) }))" :disabled="coverLocked" :aria-label="t('page.billing.memberships.category')" />
          </label>
          <Button danger :disabled="coverLocked" @click="removeRule(index)">{{ t('page.billing.memberships.removeRule') }}</Button>
        </fieldset>
        <div><Button :disabled="coverLocked || rows.length >= 100 || !campus.id.value" @click="addRule">{{ t('page.billing.memberships.addRule') }}</Button></div>
        <MutationAlert :busy="cover.busy.value" :error="cover.error.value" :uncertain="cover.uncertain.value" :success="coverSuccess" @retry="retryCoverage" />
        <div class="flex gap-2">
          <Button type="primary" :loading="cover.busy.value" :disabled="!coverReady || !coverDirty || cover.uncertain.value" @click="saveCoverage">{{ t('page.common.save') }}</Button>
          <Button v-if="cover.error.value === 'conflict'" :disabled="coverLocked" @click="load(); covering = undefined">{{ t('page.common.reloadCompare') }}</Button>
        </div>
      </div>
    </Drawer>
  </AdminPage>
</template>
