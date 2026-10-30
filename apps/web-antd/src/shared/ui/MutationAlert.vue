<script setup lang="ts">
import { useI18n } from '@vben/locales';

import { Alert, Button } from 'ant-design-vue';

import { useErrorText } from './messages';

// Outcome of a write. An unknown outcome only offers a retry of the original request.
defineProps<{
  busy: boolean;
  error: string;
  success?: string;
  uncertain: boolean;
}>();
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();
const errorText = useErrorText();
</script>

<template>
  <Alert
    v-if="uncertain"
    type="warning"
    show-icon
    :message="t('page.common.uncertain')"
    role="alert"
  >
    <template #action>
      <Button size="small" :loading="busy" @click="emit('retry')">
{{
        t('page.common.retryOriginal')
      }}
</Button>
    </template>
  </Alert>
  <Alert
    v-else-if="error"
    type="error"
    show-icon
    :message="errorText(error)"
    role="alert"
  />
  <Alert
    v-else-if="success && !busy"
    type="success"
    show-icon
    :message="success"
    role="status"
  />
</template>
