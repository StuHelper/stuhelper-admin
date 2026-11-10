<script setup lang="ts">
import type { Effective, Grant, Role, Scope } from './api';

import { computed, onMounted, reactive, ref, shallowRef } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Descriptions, DescriptionsItem, Drawer, Form, FormItem, Input, Modal, Select, Table, Tag, Textarea } from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { anyScope, useAccessAdmin } from './api';

/**
 * Role definitions and grants. Templates are starting points and grant nothing by
 * themselves. A grant gives one administrator a role within a school, group and
 * module scope; platform administrators already hold every capability. Nobody can
 * grant themselves more, and every change needs a reason and is recorded.
 */
const { t } = useI18n();
const errorText = useErrorText();
const api = useAccessAdmin();

const templates = shallowRef<Role[]>([]);
const status = ref<'error' | 'loading' | 'ready'>('loading');
const loadError = ref('');
async function loadTemplates() {
  status.value = 'loading';
  try {
    templates.value = await api.templates();
    status.value = 'ready';
  } catch (error) {
    loadError.value = errorCode(error);
    status.value = 'error';
  }
}
onMounted(loadTemplates);

// Creating a role: start from a template or from scratch; the ID cannot be reused.
const creating = ref(false);
const roleForm = reactive({ id: '', name: '', capabilities: [] as string[], reason: '' });
const createWrite = useMutation();
const created = shallowRef<Role>();
function startRole(template?: Role) {
  creating.value = true;
  created.value = undefined;
  createWrite.dismiss();
  Object.assign(roleForm, { id: template ? `${template.id}.custom` : '', name: template?.name ?? '', capabilities: [...(template?.capabilities ?? [])], reason: '' });
}
const idPattern = /^[a-z][\d._a-z-]*$/;
const roleReady = computed(() => idPattern.test(roleForm.id) && !!roleForm.name.trim() && roleForm.capabilities.length > 0 && roleForm.capabilities.length <= 64 && roleForm.capabilities.every((item) => idPattern.test(item)) && !!roleForm.reason.trim());
async function createRole() {
  if (!roleReady.value) return;
  const body = { role: { id: roleForm.id, name: roleForm.name.trim(), capabilities: [...new Set(roleForm.capabilities)] }, reason: roleForm.reason.trim() };
  const result = await createWrite.run(`role:${body.role.id}`, body, (value, key) => api.createRole(value, key));
  if (result) created.value = result;
}
async function retryRole() {
  const result = (await createWrite.retry()) as Role | undefined;
  if (result) created.value = result;
}

// Administrator grants.
const subject = ref('');
const shown = ref('');
const effective = shallowRef<Effective>();
const lookupError = ref('');
const looking = ref(false);
async function lookup(target = subject.value.trim()) {
  if (!target || looking.value) return;
  looking.value = true;
  lookupError.value = '';
  try {
    effective.value = await api.effective(target);
    shown.value = target;
  } catch (error) {
    effective.value = undefined;
    lookupError.value = errorCode(error);
  } finally {
    looking.value = false;
  }
}

const grantForm = reactive({ role: '', school: '*', group: '*', module: '*', reason: '' });
const grantWrite = useMutation();
const grantSuccess = ref('');
const scopeOf = (): Scope => ({ school: grantForm.school.trim() || '*', group: grantForm.group.trim() || '*', module: grantForm.module.trim() || '*' });
const grantReady = computed(() => idPattern.test(grantForm.role) && !!grantForm.reason.trim() && !!effective.value);
async function grant() {
  const current = effective.value;
  if (!current || !grantReady.value) return;
  grantSuccess.value = '';
  const body = { role_id: grantForm.role, scope: scopeOf(), expected_revision: current.revision, reason: grantForm.reason.trim() };
  const result = await grantWrite.run(`grant:${shown.value}:${body.role_id}:${JSON.stringify(body.scope)}:${body.expected_revision}`, body, (value, key) => api.grant(shown.value, value, key));
  if (result) await granted(t('page.access.granted'));
}
async function granted(message: string) {
  grantSuccess.value = message;
  grantForm.reason = '';
  await lookup(shown.value);
}

const revoking = shallowRef<Grant>();
const revokeReason = ref('');
const revokeWrite = useMutation();
async function revoke() {
  const current = effective.value;
  const row = revoking.value;
  if (!current || !row || !revokeReason.value.trim()) return;
  const body = { role_id: row.role.id, scope: row.scope, expected_revision: current.revision, reason: revokeReason.value.trim() };
  const result = await revokeWrite.run(`revoke:${shown.value}:${body.role_id}:${JSON.stringify(body.scope)}:${body.expected_revision}`, body, (value, key) => api.revoke(shown.value, value, key));
  if (result) await revoked();
}
async function retryRevoke() {
  if (await revokeWrite.retry()) await revoked();
}
async function revoked() {
  revoking.value = undefined;
  revokeReason.value = '';
  await granted(t('page.access.revoked'));
}
async function retryGrant() {
  if (await grantWrite.retry()) await granted(t('page.access.granted'));
}

const busy = computed(() => createWrite.busy.value || grantWrite.busy.value || revokeWrite.busy.value);
const pending = computed(() => createWrite.uncertain.value || grantWrite.uncertain.value || revokeWrite.uncertain.value);
useLeaveGuard(() => (pending.value ? t('page.common.leaveUncertain') : (busy.value || (creating.value && roleForm.reason.trim()) || grantForm.reason.trim() ? t('page.common.leaveUnsaved') : '')));
const scopeText = (scope: Scope) => [`${t('page.access.school')}: ${scope.school}`, `${t('page.access.group')}: ${scope.group}`, `${t('page.access.module')}: ${scope.module}`].join(' · ');
const isAny = (scope: Scope) => scope.school === anyScope.school && scope.group === anyScope.group && scope.module === anyScope.module;
const templateColumns = computed(() => [
  { key: 'name', title: t('page.access.role') },
  { key: 'capabilities', title: t('page.access.capabilities') },
  { key: 'action', title: t('page.common.operation') },
]);
const grantColumns = computed(() => [
  { key: 'role', title: t('page.access.role') },
  { key: 'scope', title: t('page.access.scope') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage :title="t('page.access.title')" :description="t('page.access.intro')">
    <div class="flex flex-col gap-4">
      <Card :bordered="false" :title="t('page.access.administrator')">
        <Form layout="vertical" class="max-w-2xl" @submit.prevent="lookup()">
          <FormItem :label="t('page.access.subject')" :extra="t('page.access.subjectHint')" html-for="access-subject">
            <Input id="access-subject" v-model:value="subject" :maxlength="512" autocomplete="off" />
          </FormItem>
          <Button type="primary" html-type="submit" :loading="looking" :disabled="!subject.trim()">{{ t('page.common.search') }}</Button>
        </Form>
        <Alert v-if="lookupError" class="mt-4" type="error" show-icon role="alert" :message="errorText(lookupError)" />
        <template v-if="effective">
          <Alert v-if="effective.authorization_mode === 'platform_admin_all'" class="mt-4" type="info" show-icon :message="t('page.access.platformAdmin')" />
          <Table class="mt-4" :columns="grantColumns" :data-source="effective.grants" :pagination="false" :row-key="(row: Grant) => `${row.role.id}:${JSON.stringify(row.scope)}`" size="small" :scroll="{ x: 560 }" :locale="{ emptyText: t('page.access.noGrants') }">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'role'"><b>{{ record.role.name }}</b> <code class="text-xs">{{ record.role.id }}</code></template>
              <template v-else-if="column.key === 'scope'"><Tag v-if="isAny(record.scope)">{{ t('page.access.everywhere') }}</Tag><span v-else>{{ scopeText(record.scope) }}</span></template>
              <template v-else-if="column.key === 'action'"><Button type="link" danger size="small" :disabled="busy || pending" @click="revoking = record as Grant">{{ t('page.access.revoke') }}</Button></template>
            </template>
          </Table>
          <Form layout="vertical" class="mt-4 max-w-2xl" @submit.prevent="grant">
            <h3 class="mb-2 font-medium">{{ t('page.access.grantTitle') }}</h3>
            <FormItem :label="t('page.access.roleId')" required :extra="t('page.access.roleIdHint')" html-for="access-grant-role">
              <Input id="access-grant-role" v-model:value="grantForm.role" :maxlength="128" :disabled="grantWrite.uncertain.value" autocomplete="off" />
            </FormItem>
            <div class="grid gap-3 sm:grid-cols-3">
              <FormItem :label="t('page.access.school')" html-for="access-grant-school"><Input id="access-grant-school" v-model:value="grantForm.school" :maxlength="128" :disabled="grantWrite.uncertain.value" /></FormItem>
              <FormItem :label="t('page.access.group')" html-for="access-grant-group"><Input id="access-grant-group" v-model:value="grantForm.group" :maxlength="128" :disabled="grantWrite.uncertain.value" /></FormItem>
              <FormItem :label="t('page.access.module')" html-for="access-grant-module"><Input id="access-grant-module" v-model:value="grantForm.module" :maxlength="128" :disabled="grantWrite.uncertain.value" /></FormItem>
            </div>
            <p class="text-muted-foreground mb-3 text-sm">{{ t('page.access.scopeHint') }}</p>
            <FormItem :label="t('page.common.reason')" required html-for="access-grant-reason">
              <Textarea id="access-grant-reason" v-model:value="grantForm.reason" :rows="2" :maxlength="512" :disabled="grantWrite.uncertain.value" />
            </FormItem>
            <MutationAlert :busy="grantWrite.busy.value" :error="grantWrite.error.value" :uncertain="grantWrite.uncertain.value" :success="grantSuccess" @retry="retryGrant" />
            <Button class="mt-3" type="primary" html-type="submit" :loading="grantWrite.busy.value" :disabled="!grantReady || grantWrite.uncertain.value">{{ t('page.access.grant') }}</Button>
          </Form>
        </template>
      </Card>

      <Card :bordered="false" :title="t('page.access.templates')">
        <template #extra><Button @click="startRole()">{{ t('page.access.newRole') }}</Button></template>
        <p class="text-muted-foreground mb-3 text-sm">{{ t('page.access.templatesHint') }}</p>
        <LoadState v-if="status !== 'ready'" :status="status" :error="loadError" @retry="loadTemplates" />
        <Table v-else :columns="templateColumns" :data-source="templates" :pagination="false" row-key="id" size="small" :scroll="{ x: 560 }">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'"><b>{{ record.name }}</b><div><code class="text-xs">{{ record.id }}</code></div></template>
            <template v-else-if="column.key === 'capabilities'"><Tag v-for="item in record.capabilities" :key="item" class="mb-1"><code>{{ item }}</code></Tag></template>
            <template v-else-if="column.key === 'action'"><Button type="link" size="small" @click="startRole(record as Role)">{{ t('page.access.useTemplate') }}</Button></template>
          </template>
        </Table>
      </Card>
    </div>

    <Drawer :open="creating" :width="560" :title="t('page.access.newRole')" :mask-closable="false" destroy-on-close @close="!createWrite.busy.value && !createWrite.uncertain.value && (creating = false)">
      <Descriptions v-if="created" :column="1" size="small" bordered class="mb-4">
        <DescriptionsItem :label="t('page.access.roleId')"><code>{{ created.id }}</code></DescriptionsItem>
        <DescriptionsItem :label="t('page.access.role')">{{ created.name }}</DescriptionsItem>
      </Descriptions>
      <Form v-else layout="vertical" @submit.prevent="createRole">
        <FormItem :label="t('page.access.roleId')" required :extra="t('page.access.newRoleIdHint')" html-for="access-role-id"><Input id="access-role-id" v-model:value="roleForm.id" :maxlength="128" :disabled="createWrite.uncertain.value" autocomplete="off" /></FormItem>
        <FormItem :label="t('page.access.roleName')" required html-for="access-role-name"><Input id="access-role-name" v-model:value="roleForm.name" :maxlength="128" :disabled="createWrite.uncertain.value" /></FormItem>
        <FormItem :label="t('page.access.capabilities')" required :extra="t('page.access.capabilitiesHint')" html-for="access-role-capabilities">
          <Select id="access-role-capabilities" v-model:value="roleForm.capabilities" mode="tags" :token-separators="[',', ' ']" :disabled="createWrite.uncertain.value" />
        </FormItem>
        <FormItem :label="t('page.common.reason')" required html-for="access-role-reason"><Textarea id="access-role-reason" v-model:value="roleForm.reason" :rows="2" :maxlength="512" :disabled="createWrite.uncertain.value" /></FormItem>
        <Button type="primary" html-type="submit" :loading="createWrite.busy.value" :disabled="!roleReady || createWrite.uncertain.value">{{ t('page.access.createRole') }}</Button>
      </Form>
      <MutationAlert class="mt-3" :busy="createWrite.busy.value" :error="createWrite.error.value" :uncertain="createWrite.uncertain.value" :success="created ? t('page.access.created') : ''" @retry="retryRole" />
    </Drawer>

    <Modal :open="!!revoking" :title="t('page.access.revokeTitle')" :footer="null" :mask-closable="false" @cancel="!revokeWrite.busy.value && !revokeWrite.uncertain.value && (revoking = undefined)">
      <template v-if="revoking">
        <p class="mb-3">{{ revoking.role.name }} · {{ isAny(revoking.scope) ? t('page.access.everywhere') : scopeText(revoking.scope) }}</p>
        <Form layout="vertical" @submit.prevent="revoke">
          <FormItem :label="t('page.common.reason')" required html-for="access-revoke-reason"><Textarea id="access-revoke-reason" v-model:value="revokeReason" :rows="2" :maxlength="512" :disabled="revokeWrite.uncertain.value" /></FormItem>
          <MutationAlert :busy="revokeWrite.busy.value" :error="revokeWrite.error.value" :uncertain="revokeWrite.uncertain.value" @retry="retryRevoke" />
          <div class="mt-3 flex gap-2">
            <Button danger type="primary" html-type="submit" :loading="revokeWrite.busy.value" :disabled="!revokeReason.trim() || revokeWrite.uncertain.value">{{ t('page.access.confirmRevoke') }}</Button>
            <Button :disabled="revokeWrite.busy.value || revokeWrite.uncertain.value" @click="revoking = undefined">{{ t('page.common.cancel') }}</Button>
          </div>
        </Form>
      </template>
    </Modal>
  </AdminPage>
</template>
