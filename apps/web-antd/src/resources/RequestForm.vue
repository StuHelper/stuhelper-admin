<script setup lang="ts">
import { ref } from 'vue';

import { useI18n } from '@vben/locales';

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
    <p v-if="done" role="status">
      {{ t('page.resources.requestReceived') }}
    </p>
    <fieldset :disabled="busy || uncertain || done">
      <legend>{{ t('page.resources.requestInformation') }}</legend>
      <label class="resource-field">{{ t('page.resources.requestKind')
        }}<select v-model="kind">
          <option v-if="!previousTaskId" value="complaint">
            {{ t('page.resources.requestKinds.complaint') }}
          </option>
          <option v-if="owned && !previousTaskId" value="withdrawal">
            {{ t('page.resources.requestKinds.withdrawal') }}
          </option>
          <option v-if="previousTaskId" value="appeal">
            {{ t('page.resources.requestKinds.appeal') }}
          </option>
        </select></label><label class="resource-field">{{ t('page.resources.reason')
        }}<textarea
          v-model="reason"
          required
          maxlength="2000"
        ></textarea></label><label class="resource-field">{{ t('page.resources.contact')
        }}<input
          v-model="contact"
          :required="kind === 'complaint'"
          maxlength="500"
/></label><label class="resource-field">{{ t('page.resources.evidence')
        }}<textarea
          v-model="evidence"
          :required="kind === 'complaint'"
          maxlength="8003"
        ></textarea>
      </label>
      <p>{{ t('page.resources.evidenceHint') }}</p>
    </fieldset>
    <button v-if="!done" type="submit" :disabled="busy">
      {{ t(uncertain ? 'page.resources.retry' : 'page.resources.sendRequest') }}
    </button>
  </form>
</template>
