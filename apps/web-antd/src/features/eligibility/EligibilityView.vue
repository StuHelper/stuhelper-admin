<script setup lang="ts">
import type { Action, Condition, Rule } from './api';

import { computed, onMounted, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Checkbox, Drawer, Table, Tag } from 'ant-design-vue';

import { useCampus } from '#/features/academic/campus';
import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { actions, conditions, everySchool, useEligibilityAdmin } from './api';

/**
 * Conditions each action requires, for the whole platform and for the served
 * school. The school column shows the rule in effect there, which is the
 * platform default until the school saves its own rule. A cell the
 * administrator may not read shows its own error; the server decides on
 * every read and write.
 */
type Cell = Rule | string;
type Row = { action: Action; school?: Cell; site?: Cell };
const { t } = useI18n();
const errorText = useErrorText();
const api = useEligibilityAdmin();
const campus = useCampus();

const status = ref<'error' | 'loading' | 'ready'>('loading');
const loadError = ref('');
const rows = shallowRef<Row[]>([]);
const read = (school: string, action: Action) => api.rule(school, action).catch((error: unknown) => errorCode(error));
async function load() {
  status.value = 'loading';
  loadError.value = '';
  if (campus.status.value !== 'ready') await campus.load();
  if (campus.status.value !== 'ready') {
    loadError.value = campus.failure.value;
    status.value = 'error';
    return;
  }
  const school = campus.id.value;
  rows.value = await Promise.all(actions.map(async (action) => ({ action, site: await read(everySchool, action), school: await read(school, action) })));
  status.value = 'ready';
}
onMounted(load);

// One drawer edits one rule. The version sent is the one read; a change saved
// elsewhere meanwhile is rejected and the table is read again.
const editing = shallowRef<{ action: Action; rule: Rule; scope: 'school' | 'site' }>();
const chosen = ref<Condition[]>([]);
const write = useMutation();
const success = ref('');
const locked = computed(() => write.busy.value || write.uncertain.value);
const dirty = computed(() => !!editing.value && chosen.value.toSorted().join(',') !== editing.value.rule.conditions.toSorted().join(','));
useLeaveGuard(() => (write.uncertain.value ? t('page.common.leaveUncertain') : (dirty.value || write.busy.value ? t('page.common.leaveUnsaved') : '')));

function edit(action: Action, scope: 'school' | 'site', rule: Rule) {
  editing.value = { action, scope, rule };
  chosen.value = [...rule.conditions];
  success.value = '';
  write.dismiss();
}
function close() {
  if (!locked.value) editing.value = undefined;
}
function toggle(condition: Condition, on: boolean) {
  chosen.value = on ? [...chosen.value, condition] : chosen.value.filter((item) => item !== condition);
}
async function save() {
  const current = editing.value;
  if (!current) return;
  const school = current.scope === 'site' ? everySchool : campus.id.value;
  // Conditions are sent in catalog order so the same choice always forms the same request.
  const body = { expected_version: current.rule.version, conditions: conditions.filter((item) => chosen.value.includes(item)) };
  const result = await write.run(`eligibility:${school}:${current.action}`, body, (value, key) => api.save(school, current.action, value, key));
  if (result) await saved(result);
}
async function retry() {
  const result = (await write.retry()) as Rule | undefined;
  if (result) await saved(result);
}
async function saved(result: Rule) {
  const current = editing.value;
  if (current) editing.value = { ...current, rule: result };
  success.value = t('page.common.saved');
  await load();
}

const columns = computed(() => [
  { key: 'action', title: t('page.eligibility.action') },
  { key: 'site', title: t('page.eligibility.site') },
  { key: 'school', title: t('page.eligibility.school') },
]);
type Scope = 'school' | 'site';
const scopes = new Set<unknown>(['school', 'site']);
const isScope = (key: unknown): key is Scope => scopes.has(key);
const ruleOf = (row: Row, scope: Scope) => {
  const cell = row[scope];
  return cell && typeof cell === 'object' ? cell : undefined;
};
const failureOf = (row: Row, scope: Scope) => (typeof row[scope] === 'string' ? row[scope] : 'unavailable');
</script>

<template>
  <AdminPage :title="t('page.eligibility.title')" :description="t('page.eligibility.intro')">
    <Card :bordered="false">
      <LoadState v-if="status !== 'ready'" :status="status" :error="loadError" @retry="load" />
      <Table v-else :columns="columns" :data-source="rows" :pagination="false" row-key="action" size="middle" :scroll="{ x: 860 }">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <div class="flex flex-col">
              <span>{{ t(`page.eligibility.actions.${record.action.replaceAll('.', '_')}`) }}</span>
              <code class="text-muted-foreground text-xs">{{ record.action }}</code>
            </div>
          </template>
          <template v-else-if="isScope(column.key)">
            <div v-if="ruleOf(record as Row, column.key)" class="flex flex-wrap items-center gap-1">
              <Tag v-for="condition in ruleOf(record as Row, column.key)!.conditions" :key="condition">{{ t(`page.eligibility.conditions.${condition}`) }}</Tag>
              <span v-if="ruleOf(record as Row, column.key)!.conditions.length === 0" class="text-muted-foreground text-sm">{{ t('page.eligibility.signedIn') }}</span>
              <Button type="link" size="small" :aria-label="t(`page.eligibility.edit.${column.key}`, { action: record.action })" @click="edit(record.action, column.key, ruleOf(record as Row, column.key)!)">{{ t('page.common.edit') }}</Button>
            </div>
            <span v-else class="text-sm text-red-600">{{ errorText(failureOf(record as Row, column.key)) }}</span>
          </template>
        </template>
      </Table>
    </Card>

    <Drawer :open="!!editing" :width="560" :title="editing ? t(`page.eligibility.edit.${editing.scope}`, { action: editing.action }) : ''" :mask-closable="false" destroy-on-close @close="close">
      <div v-if="editing" class="flex flex-col gap-3">
        <Alert type="info" show-icon :message="t(editing.scope === 'site' ? 'page.eligibility.siteHint' : 'page.eligibility.schoolHint')" />
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-sm">{{ t('page.eligibility.required') }}</legend>
          <Checkbox v-for="condition in conditions" :key="condition" :checked="chosen.includes(condition)" :disabled="locked" @change="(event) => toggle(condition, event.target.checked)">
            {{ t(`page.eligibility.conditions.${condition}`) }}
          </Checkbox>
        </fieldset>
        <p v-if="chosen.length === 0" class="text-muted-foreground text-sm">{{ t('page.eligibility.onlySignIn') }}</p>
        <MutationAlert :busy="write.busy.value" :error="write.error.value" :uncertain="write.uncertain.value" :success="success" @retry="retry" />
        <div class="flex gap-2">
          <Button type="primary" :loading="write.busy.value" :disabled="!dirty || write.uncertain.value" @click="save">{{ t('page.common.save') }}</Button>
          <Button v-if="write.error.value === 'conflict'" :disabled="locked" @click="load(); editing = undefined">{{ t('page.common.reloadCompare') }}</Button>
        </div>
      </div>
    </Drawer>
  </AdminPage>
</template>
