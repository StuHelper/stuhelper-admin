<script setup lang="ts">
import type { components } from '#/api/storage.gen';

import { computed, onMounted, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Card, Form, FormItem, Input, Select, Space } from 'ant-design-vue';

import { schemaOf } from '#/shared/api/schema';
import { useAsync, useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useHttp } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import contract from '../../../../../contracts/storage.openapi.json';

type Policy = components['schemas']['ContributionAdmissionPolicy'];
const endpoint = '/api/v1/storage/contribution-admission-policy';
const parser = schemaOf<Policy>(contract.components.schemas, 'ContributionAdmissionPolicy');
const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const ownerId = /^owner:[a-f0-9]{64}$/;
const { t } = useI18n();
const http = useHttp();
const policy = useAsync((signal) => http.json(endpoint, parser, { signal }));
const draft = ref<Policy>();
const saved = ref(false);
const write = useMutation({ onDenied: () => { draft.value = undefined; } });
const busy = computed(() => write.busy.value || write.uncertain.value);
const kinds = computed(() => (['contributor', 'role', 'group'] as const).map(value => ({ value, label: t(`page.admissions.${value}`) })));
const levels = computed(() => [
  { value: 'public', label: t('page.admissions.public') },
  { value: 'quarantine', label: t('page.admissions.quarantine') },
  { value: 'restricted', label: t('page.admissions.restricted') },
]);

function snapshot(value: Policy): Policy {
  return {
    revision: value.revision,
    memberships: value.memberships.map((member) => ({
      owner_domain: member.owner_domain, role_ids: [...member.role_ids], group_ids: [...member.group_ids],
    })),
    rules: value.rules.map((rule) => ({
      subject_kind: rule.subject_kind,
      subject_id: rule.subject_id,
      ...(rule.instance_id ? { instance_id: rule.instance_id } : {}),
      levels: [...rule.levels],
    })),
  };
}

function useSnapshot(value: Policy) {
  draft.value = snapshot(value);
}

watch(policy.data, (value) => { if (value) useSnapshot(value); });
onMounted(policy.reload);
useLeaveGuard(() => write.uncertain.value ? t('page.common.leaveUncertain') : '');

const valid = computed(() => {
  const value = draft.value;
  if (!value) return false;
  const keys = value.rules.map(r => JSON.stringify([r.subject_kind, r.subject_id, r.instance_id || '']));
  const owners = value.memberships.map(m => m.owner_domain);
  return new Set(keys).size === keys.length && new Set(owners).size === owners.length &&
    value.rules.every(r =>
      (r.subject_kind === 'contributor' ? ownerId : id).test(r.subject_id) &&
      (!r.instance_id || id.test(r.instance_id)) && r.levels.length <= 32 && r.levels.every(level => id.test(level)),
    ) &&
    value.memberships.every(m =>
      ownerId.test(m.owner_domain) && m.role_ids.length <= 20 && m.group_ids.length <= 20 &&
      [...m.role_ids, ...m.group_ids].every(value => id.test(value)),
    );
});

async function reload() {
  if (busy.value) return;
  saved.value = false;
  await policy.reload();
}
async function save() {
  if (!draft.value || !valid.value || busy.value) return;
  saved.value = false;
  const body = snapshot(draft.value);
  const result = await write.run(`admissions:${body.revision}`, body, (value, key) =>
    http.json(endpoint, parser, { method: 'PUT', body: value, key }),
  );
  if (result) {
    useSnapshot(result);
    saved.value = true;
  }
}
async function retry() {
  if (await write.retry()) {
    await policy.reload();
    saved.value = policy.status.value === 'ready';
  }
}
</script>

<template>
  <AdminPage :title="t('page.admissions.title')" :description="t('page.admissions.help')">
    <LoadState :status="policy.status.value" :error="policy.error.value" @retry="reload">
      <Form v-if="draft" layout="vertical" class="flex flex-col gap-4" @submit.prevent="save">
        <MutationAlert :busy="write.busy.value" :uncertain="write.uncertain.value" :error="write.error.value" :success="saved ? t('page.common.saved') : undefined" @retry="retry" />
        <Card :title="t('page.admissions.rules')">
          <div v-for="(rule, index) in draft.rules" :key="index" class="mb-4 grid gap-2 rounded border p-3 md:grid-cols-2">
            <FormItem :label="t('page.admissions.subject')" :html-for="`admission-subject-${index}`">
              <Select :id="`admission-subject-${index}`" v-model:value="rule.subject_kind" :options="kinds" :disabled="busy" />
            </FormItem>
            <FormItem :label="t('page.admissions.subjectId')" :html-for="`admission-subject-id-${index}`">
              <Input :id="`admission-subject-id-${index}`" v-model:value="rule.subject_id" :maxlength="128" :disabled="busy" />
            </FormItem>
            <FormItem :label="t('page.admissions.instance')" :html-for="`admission-instance-${index}`">
              <Input :id="`admission-instance-${index}`" v-model:value="rule.instance_id" :maxlength="128" :disabled="busy" />
            </FormItem>
            <FormItem :label="t('page.admissions.levels')" :html-for="`admission-levels-${index}`">
              <Select :id="`admission-levels-${index}`" v-model:value="rule.levels" mode="tags" :options="levels" :disabled="busy" />
            </FormItem>
            <Button class="justify-self-start" danger :disabled="busy" @click="draft.rules.splice(index, 1)">{{ t('page.admissions.remove') }}</Button>
          </div>
          <Button :disabled="busy || draft.rules.length === 100" @click="draft.rules.push({ subject_kind: 'contributor', subject_id: '', levels: ['public'] })">{{ t('page.admissions.addRule') }}</Button>
        </Card>
        <Card :title="t('page.admissions.memberships')">
          <div v-for="(member, index) in draft.memberships" :key="index" class="mb-4 grid gap-2 rounded border p-3 md:grid-cols-3">
            <FormItem :label="t('page.admissions.contributor')" :html-for="`admission-member-${index}`">
              <Input :id="`admission-member-${index}`" v-model:value="member.owner_domain" :maxlength="70" :disabled="busy" />
            </FormItem>
            <FormItem :label="t('page.admissions.role')" :html-for="`admission-role-${index}`">
              <Select :id="`admission-role-${index}`" v-model:value="member.role_ids" mode="tags" :disabled="busy" />
            </FormItem>
            <FormItem :label="t('page.admissions.group')" :html-for="`admission-group-${index}`">
              <Select :id="`admission-group-${index}`" v-model:value="member.group_ids" mode="tags" :disabled="busy" />
            </FormItem>
            <Button class="justify-self-start" danger :disabled="busy" @click="draft.memberships.splice(index, 1)">{{ t('page.admissions.remove') }}</Button>
          </div>
          <Button :disabled="busy || draft.memberships.length === 100" @click="draft.memberships.push({ owner_domain: '', role_ids: [], group_ids: [] })">{{ t('page.admissions.addMember') }}</Button>
        </Card>
        <Space wrap>
          <Button type="primary" html-type="submit" :loading="write.busy.value" :disabled="!valid || busy">{{ t('page.common.save') }}</Button>
          <Button :disabled="busy" @click="reload">{{ t('page.common.refresh') }}</Button>
        </Space>
      </Form>
    </LoadState>
  </AdminPage>
</template>
