<script setup lang="ts">
import type { Policy } from './api';

import { computed, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Form,
  FormItem,
  Radio,
  RadioGroup,
  Select,
  Space,
  Textarea,
} from 'ant-design-vue';

import { useAsync, useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useAcademicAdmin } from './api';
import { useCampusId } from './campus';
import CampusPending from './CampusPending.vue';

// Review mode and blocked terms per content kind, for one school or globally.
const { t } = useI18n();
const api = useAcademicAdmin();
const save = useMutation();
const school = useCampusId();
const scope = ref<'global' | 'school'>('school');
const kind = ref('course');
const mode = ref<Policy['mode']>('published');
const words = ref('');
const baseline = ref('');
const success = ref('');
const target = computed(() => (scope.value === 'global' ? '*' : school.value));
const form = () => JSON.stringify([mode.value, words.value]);
const dirty = computed(
  () => baseline.value !== '' && baseline.value !== form(),
);
const locked = computed(() => save.busy.value || save.uncertain.value);
const policy = useAsync((signal) =>
  api.policy({ school_id: target.value, kind: kind.value }, signal),
);

async function load(compare = false) {
  await policy.reload();
  const value = policy.data.value;
  if (!value || compare) return;
  mode.value = value.effective.mode;
  words.value = value.effective.blocked_terms.join('\n');
  baseline.value = form();
}
watch([target, kind], () => {
  success.value = '';
  if (target.value) void load();
});
useLeaveGuard(() => (dirty.value || locked.value ? t(save.uncertain.value ? 'page.common.leaveUncertain' : 'page.common.leaveUnsaved') : ''));

async function submit() {
  success.value = '';
  const body: Policy = {
    school_id: target.value,
    kind: kind.value,
    mode: mode.value,
    blocked_terms: [
      ...new Set(
        words.value
          .split('\n')
          .map((word) => word.trim())
          .filter(Boolean),
      ),
    ],
    revision: policy.data.value?.configured?.revision ?? 0,
  };
  if (
    await save.run(`policy:${target.value}:${kind.value}`, body, (value, key) =>
      api.savePolicy(value, key),
    )
  )
    saved();
}
async function retry() {
  if (await save.retry()) saved();
}
async function saved() {
  baseline.value = form();
  success.value = t('page.common.saved');
  await load();
}
</script>

<template>
  <AdminPage
    :title="t('page.moderation.policyTitle')"
    :description="t('page.moderation.policyIntro')"
  >
    <div class="flex flex-col gap-4">
      <Card :bordered="false">
        <Form layout="inline" class="flex flex-wrap gap-y-3">
<FormItem :label="t('page.moderation.contentKind')" html-for="policyview-field-1">
            <Select
id="policyview-field-1"
              v-model:value="kind"
              class="w-36"
              :disabled="locked || dirty"
              :options="
                ['course', 'mentor', 'reply'].map((value) => ({
                  value,
                  label: t(`page.moderation.kind.${value}`),
                }))
              "
            />
          </FormItem>
        </Form>
      </Card>
      <CampusPending v-if="!target" @ready="school = $event" />
      <Card v-if="target" :bordered="false">
        <LoadState
          :status="policy.status.value"
          :error="policy.error.value"
          @retry="load()"
        >
          <Form
            v-if="policy.data.value"
            layout="vertical"
            class="max-w-2xl"
            @submit.prevent="submit"
          >
            <Alert
              class="mb-4"
              type="info"
              show-icon
              :message="
                t(`page.moderation.policySource.${policy.data.value.source}`)
              "
            />
            <FormItem :label="t('page.moderation.policyMode')">
              <RadioGroup v-model:value="mode" :disabled="locked">
                <Radio
                  v-for="value in ['published', 'pending', 'review']"
                  :key="value"
                  :value="value"
                  class="block"
                  >
{{ t(`page.moderation.policyModes.${value}`) }}
</Radio>
              </RadioGroup>
            </FormItem>
            <FormItem
              :label="t('page.moderation.blockedTerms')"
              :extra="t('page.moderation.blockedTermsHint')"
             html-for="policyview-field-2"
>
              <Textarea
id="policyview-field-2"
                v-model:value="words"
                :rows="8"
                :maxlength="10000"
                :disabled="locked"
              />
            </FormItem>
            <MutationAlert
              :busy="save.busy.value"
              :error="save.error.value"
              :uncertain="save.uncertain.value"
              :success="success"
              @retry="retry"
            />
            <Space class="mt-4" wrap>
              <Button
                type="primary"
                html-type="submit"
                :loading="save.busy.value"
                :disabled="save.uncertain.value || !dirty"
                >
{{ t('page.common.save') }}
</Button>
              <Button
                v-if="save.error.value === 'conflict'"
                :disabled="locked"
                @click="load(true)"
                >
{{ t('page.common.reloadCompare') }}
</Button>
              <Button :disabled="locked || !dirty" @click="load()">
{{
                t('page.common.discard')
              }}
</Button>
            </Space>
          </Form>
        </LoadState>
      </Card>
    </div>
  </AdminPage>
</template>
