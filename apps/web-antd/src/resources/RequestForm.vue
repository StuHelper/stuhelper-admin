<script setup lang="ts">
import { ref } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Input, Select, Textarea } from 'ant-design-vue';

import { type Schema, segment } from './api';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';
const props = defineProps<{
  owned?: boolean;
  previousTaskId?: string;
  resourceId: string;
}>();
const emit = defineEmits<{ saved: [value: Schema['RequestReceipt']] }>();
const { t } = useI18n();
const contact = ref('');
const done = ref(false);
const evidence = ref('');
const kind = ref(props.previousTaskId ? 'appeal' : 'complaint');
const reason = ref('');
const state = useResources(() => {
  reason.value = '';
  contact.value = '';
  evidence.value = '';
});
const { busy, error, uncertain } = state;
async function submit() {
  await state.run(async () => {
    const value = await state.mutation.run(
      '/items/' + segment(props.resourceId) + '/requests',
      'RequestReceipt',
      {
        kind: kind.value,
        reason: reason.value,
        contact: contact.value,
        evidence: evidence.value
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
        ...(props.previousTaskId
          ? { previous_task_id: props.previousTaskId }
          : {}),
      },
    );
    done.value = true;
    emit('saved', value);
  });
}
</script>
<template>
  <form class="resource-form" @submit.prevent="submit">
    <h2>{{ t('page.resources.request') }}</h2>
    <StatusBlock :busy="busy" :error="error" @retry="state.retry" />
    <Alert v-if="done" type="success" show-icon role="status" :message="t('page.resources.requestReceived')" />
    <fieldset :disabled="busy || uncertain || done">
      <legend>{{ t('page.resources.requestInformation') }}</legend>
      <label class="resource-field">{{ t('page.resources.requestKind') }}
        <Select
          v-model:value="kind"
          :disabled="busy || uncertain || done"
          :options="[
            ...(!previousTaskId ? [{ value: 'complaint', label: t('page.resources.requestKinds.complaint') }] : []),
            ...(owned && !previousTaskId ? [{ value: 'withdrawal', label: t('page.resources.requestKinds.withdrawal') }] : []),
            ...(previousTaskId ? [{ value: 'appeal', label: t('page.resources.requestKinds.appeal') }] : []),
          ]"
        />
      </label>
      <label class="resource-field">{{ t('page.resources.reason') }}<Textarea v-model:value="reason" required :maxlength="2000" /></label>
      <label class="resource-field">{{ t('page.resources.contact') }}<Input v-model:value="contact" :required="kind === 'complaint'" :maxlength="500" /></label>
      <label class="resource-field">{{ t('page.resources.evidence') }}<Textarea v-model:value="evidence" :required="kind === 'complaint'" :maxlength="8003" /></label>
      <p class="resource-muted">{{ t('page.resources.evidenceHint') }}</p>
    </fieldset>
    <Button v-if="!done" type="primary" html-type="submit" class="justify-self-start" :loading="busy">{{ t(uncertain ? 'page.resources.retry' : 'page.resources.sendRequest') }}</Button>
  </form>
</template>
