<script setup lang="ts">
import type { Audit, Domain, Query, Record, Scope, Sensitive } from './api';

import { computed, onBeforeUnmount, reactive, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Checkbox, CheckboxGroup, Form, FormItem, Input, Select, TabPane, Tabs, Tag, Textarea } from 'ant-design-vue';

import { ApiError, errorCode } from '#/shared/api/errors';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';

import { domains, kinds, pageSize, sensitive, useInformationQuery } from './api';

/**
 * Look up the records linked to one person across business modules. Every query
 * states its purpose and is recorded before results are released. Identity fields
 * arrive masked unless a sensitive category is requested and granted; domains the
 * viewer may read but that have no provider yet are named, so a short list is
 * never mistaken for a complete one.
 */
const { t, te } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useInformationQuery();
const label = (key: string, fallback: string) => (te(key) ? t(key) : fallback);

const form = reactive({ kind: 'name' as Query['kind'], value: '', school: '*', group: '*', module: '*', domains: [...domains] as Domain[], fields: [] as Sensitive[], purpose: '' });
const scope = (): Scope => ({ school: form.school.trim() || '*', group: form.group.trim() || '*', module: form.module.trim() || '*' });
const ready = computed(() => !!form.value.trim() && !!form.purpose.trim() && form.domains.length > 0);

const items = shallowRef<Record[]>([]);
const unavailable = shallowRef<string[]>([]);
const next = ref('');
const status = ref<'error' | 'idle' | 'loading' | 'ready'>('idle');
const loadError = ref('');
const appending = ref(false);
let applied: Query | undefined;
let controller: AbortController | undefined;

function clear() {
  items.value = [];
  unavailable.value = [];
  next.value = '';
}
function fail(error: unknown) {
  loadError.value = errorCode(error);
  // Losing access removes what was shown under the old grants.
  if (error instanceof ApiError && error.denied) clear();
}
async function run(after: string) {
  if (!applied) return;
  controller?.abort();
  controller = new AbortController();
  const result = await api.query({ ...applied, ...(after ? { after } : {}) }, controller.signal);
  unavailable.value = result.unavailable_domains;
  next.value = result.next_cursor;
  return result.items;
}
async function search() {
  if (!ready.value) return;
  applied = { kind: form.kind, value: form.value.trim(), scope: scope(), domains: [...form.domains], fields: [...form.fields], purpose: form.purpose.trim(), limit: pageSize };
  clear();
  status.value = 'loading';
  loadError.value = '';
  try {
    items.value = (await run('')) ?? [];
    status.value = 'ready';
  } catch (error) {
    fail(error);
    status.value = 'error';
  }
}
async function more() {
  if (!next.value || appending.value) return;
  appending.value = true;
  loadError.value = '';
  try {
    items.value = [...items.value, ...((await run(next.value)) ?? [])];
  } catch (error) {
    fail(error);
  } finally {
    appending.value = false;
  }
}
onBeforeUnmount(() => {
  controller?.abort();
  clear();
});

// The record of queries, filtered by scope and purpose; reading it needs its own capability.
const auditForm = reactive({ school: '*', group: '*', module: '*', purpose: '' });
const audits = shallowRef<Audit[]>([]);
const auditNext = ref('');
const auditStatus = ref<'error' | 'idle' | 'loading' | 'ready'>('idle');
const auditError = ref('');
let auditApplied: undefined | { purpose: string; scope: Scope };
async function loadAudit(after: string) {
  if (!auditApplied) return;
  if (!after) auditStatus.value = 'loading';
  auditError.value = '';
  try {
    const page = await api.audit(auditApplied.scope, auditApplied.purpose, after);
    audits.value = after ? [...audits.value, ...page.items] : page.items;
    auditNext.value = page.next_cursor;
    auditStatus.value = 'ready';
  } catch (error) {
    auditError.value = errorCode(error);
    if (error instanceof ApiError && error.denied) audits.value = [];
    if (!after || audits.value.length === 0) auditStatus.value = 'error';
  }
}
function searchAudit() {
  if (!auditForm.purpose.trim()) return;
  auditApplied = { purpose: auditForm.purpose.trim(), scope: { school: auditForm.school.trim() || '*', group: auditForm.group.trim() || '*', module: auditForm.module.trim() || '*' } };
  void loadAudit('');
}

const scopeText = (value: Scope) => [value.school, value.group, value.module].map((part) => (part === '*' ? t('page.lookup.any') : part)).join(' / ');
</script>

<template>
  <AdminPage :title="t('page.lookup.title')" :description="t('page.lookup.intro')">
    <Tabs>
      <TabPane key="query" :tab="t('page.lookup.queryTab')">
        <div class="flex flex-col gap-4">
          <Card :bordered="false">
            <Form layout="vertical" @submit.prevent="search">
              <div class="grid gap-3 md:grid-cols-3">
                <FormItem :label="t('page.lookup.kind')" html-for="lookup-kind">
                  <Select id="lookup-kind" v-model:value="form.kind" :options="kinds.map((value) => ({ value, label: t(`page.lookup.kinds.${value}`) }))" />
                </FormItem>
                <FormItem class="md:col-span-2" :label="t('page.lookup.value')" required html-for="lookup-value">
                  <Input id="lookup-value" v-model:value="form.value" :maxlength="256" autocomplete="off" allow-clear />
                </FormItem>
                <FormItem :label="t('page.access.school')" html-for="lookup-school"><Input id="lookup-school" v-model:value="form.school" :maxlength="128" /></FormItem>
                <FormItem :label="t('page.access.group')" html-for="lookup-group"><Input id="lookup-group" v-model:value="form.group" :maxlength="128" /></FormItem>
                <FormItem :label="t('page.access.module')" html-for="lookup-module"><Input id="lookup-module" v-model:value="form.module" :maxlength="128" /></FormItem>
              </div>
              <p class="text-muted-foreground -mt-2 mb-3 text-xs">{{ t('page.access.scopeHint') }}</p>
              <FormItem :label="t('page.lookup.domains')">
                <CheckboxGroup v-model:value="form.domains">
                  <Checkbox v-for="domain in domains" :key="domain" :value="domain">{{ t(`page.lookup.domainNames.${domain}`) }}</Checkbox>
                </CheckboxGroup>
              </FormItem>
              <FormItem :label="t('page.lookup.sensitive')" :extra="t('page.lookup.sensitiveHint')">
                <CheckboxGroup v-model:value="form.fields">
                  <Checkbox v-for="field in sensitive" :key="field" :value="field">{{ t(`page.lookup.categories.${field}`) }}</Checkbox>
                </CheckboxGroup>
              </FormItem>
              <FormItem :label="t('page.lookup.purpose')" required :extra="t('page.lookup.purposeHint')" html-for="lookup-purpose">
                <Textarea id="lookup-purpose" v-model:value="form.purpose" :rows="2" :maxlength="512" />
              </FormItem>
              <Button type="primary" html-type="submit" :loading="status === 'loading'" :disabled="!ready">{{ t('page.lookup.submit') }}</Button>
            </Form>
          </Card>
          <Alert v-if="unavailable.length > 0" type="warning" show-icon role="alert" :message="t('page.lookup.incomplete', { domains: format.list(unavailable.map((value) => label(`page.lookup.domainNames.${value}`, value))) })" />
          <Card v-if="status !== 'idle'" :bordered="false">
            <LoadState v-if="status !== 'ready' || items.length === 0" :status="status" :error="loadError" :empty="true" :empty-text="t('page.lookup.empty')" @retry="search" />
            <template v-else>
              <ul class="flex flex-col gap-3" :aria-label="t('page.lookup.results')">
                <li v-for="record in items" :key="`${record.source}:${record.id}`" class="border-border rounded-md border p-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <Tag color="blue">{{ label(`page.lookup.domainNames.${record.source}`, record.source) }}</Tag>
                    <Tag :color="record.current ? 'green' : 'default'">{{ record.current ? t('page.lookup.current') : t('page.lookup.historical') }}</Tag>
                    <code class="break-all text-xs">{{ record.subject }}</code>
                    <span class="text-muted-foreground text-xs">{{ scopeText(record.scope) }} · {{ t('page.lookup.changedAt', { time: format.dateTime(record.changed_at) }) }}</span>
                  </div>
                  <dl class="mt-2 grid gap-x-4 gap-y-1 text-sm md:grid-cols-[max-content_1fr]">
                    <template v-for="field in record.fields" :key="field.name">
                      <dt class="text-muted-foreground">{{ label(`page.lookup.fieldNames.${field.name}`, field.name) }}</dt>
                      <dd class="m-0 break-all">
                        {{ field.value }}
                        <Tag v-if="field.masked" class="ms-1">{{ t('page.lookup.masked') }}</Tag>
                        <Tag v-if="field.category !== 'business'" class="ms-1" color="orange">{{ t(`page.lookup.categories.${field.category}`) }}</Tag>
                      </dd>
                    </template>
                  </dl>
                </li>
              </ul>
              <Alert v-if="loadError" class="mt-3" type="error" show-icon :message="errorText(loadError)" />
              <div class="mt-4 flex justify-center">
                <Button v-if="next" :loading="appending" @click="more">{{ t('page.common.loadMore') }}</Button>
              </div>
            </template>
          </Card>
        </div>
      </TabPane>
      <TabPane key="audit" :tab="t('page.lookup.auditTab')">
        <div class="flex flex-col gap-4">
          <Card :bordered="false">
            <Form layout="vertical" @submit.prevent="searchAudit">
              <div class="grid gap-3 md:grid-cols-3">
                <FormItem :label="t('page.access.school')" html-for="lookup-audit-school"><Input id="lookup-audit-school" v-model:value="auditForm.school" :maxlength="128" /></FormItem>
                <FormItem :label="t('page.access.group')" html-for="lookup-audit-group"><Input id="lookup-audit-group" v-model:value="auditForm.group" :maxlength="128" /></FormItem>
                <FormItem :label="t('page.access.module')" html-for="lookup-audit-module"><Input id="lookup-audit-module" v-model:value="auditForm.module" :maxlength="128" /></FormItem>
              </div>
              <FormItem :label="t('page.lookup.purpose')" required :extra="t('page.lookup.auditPurposeHint')" html-for="lookup-audit-purpose">
                <Textarea id="lookup-audit-purpose" v-model:value="auditForm.purpose" :rows="2" :maxlength="512" />
              </FormItem>
              <Button type="primary" html-type="submit" :loading="auditStatus === 'loading'" :disabled="!auditForm.purpose.trim()">{{ t('page.common.search') }}</Button>
            </Form>
          </Card>
          <Card v-if="auditStatus !== 'idle'" :bordered="false">
            <LoadState v-if="auditStatus !== 'ready' || audits.length === 0" :status="auditStatus" :error="auditError" :empty="true" :empty-text="t('page.lookup.auditEmpty')" @retry="loadAudit('')" />
            <template v-else>
              <ul class="flex flex-col gap-3" :aria-label="t('page.lookup.auditTab')">
                <li v-for="entry in audits" :key="entry.id" class="border-border rounded-md border p-3 text-sm">
                  <div class="flex flex-wrap items-center gap-2">
                    <span>{{ format.dateTime(entry.created_at) }}</span>
                    <code class="text-xs">{{ entry.action }}</code>
                    <Tag :color="entry.result === 'success' ? 'green' : entry.result === 'denied' ? 'orange' : 'default'">{{ label(`page.audit.results.${entry.result}`, entry.result) }}</Tag>
                    <span class="text-muted-foreground text-xs">{{ scopeText(entry.scope) }}</span>
                  </div>
                  <div class="mt-1">{{ t('page.lookup.auditActor') }}: <code class="break-all text-xs">{{ entry.actor }}</code></div>
                  <div>{{ t('page.lookup.purpose') }}: {{ entry.purpose }}</div>
                  <div>{{ t('page.lookup.auditCount', { count: format.number(entry.count) }) }}</div>
                  <div v-if="entry.fields.length > 0">{{ t('page.lookup.sensitive') }}: {{ format.list(entry.fields.map((value) => label(`page.lookup.categories.${value}`, value))) }}</div>
                  <div v-if="entry.target_group">{{ t('page.lookup.auditChannel', { channel: entry.channel, group: entry.target_group }) }}</div>
                </li>
              </ul>
              <Alert v-if="auditError" class="mt-3" type="error" show-icon :message="errorText(auditError)" />
              <div class="mt-4 flex justify-center">
                <Button v-if="auditNext" @click="loadAudit(auditNext)">{{ t('page.common.loadMore') }}</Button>
              </div>
            </template>
          </Card>
        </div>
      </TabPane>
    </Tabs>
  </AdminPage>
</template>
