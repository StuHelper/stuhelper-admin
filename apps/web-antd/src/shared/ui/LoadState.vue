<script setup lang="ts">
import type { LoadStatus } from '../composables/async';

import { useI18n } from '@vben/locales';

import { Alert, Button, Empty, Skeleton } from 'ant-design-vue';

import { useErrorText } from './messages';

// Loading, failure with retry, and empty states for one request.
withDefaults(
  defineProps<{
    empty?: boolean;
    emptyText?: string;
    error?: string;
    status: LoadStatus;
  }>(),
  { empty: false, emptyText: '', error: '' },
);
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();
const errorText = useErrorText();
</script>

<template>
  <Skeleton v-if="status === 'loading'" active :paragraph="{ rows: 3 }" />
  <Alert
    v-else-if="status === 'error'"
    type="error"
    show-icon
    :message="errorText(error)"
    role="alert"
  >
    <template #action>
      <Button size="small" @click="emit('retry')">
{{
        t('page.common.retry')
      }}
</Button>
    </template>
  </Alert>
  <template v-else-if="status === 'ready'">
    <Empty v-if="empty" :description="emptyText || t('page.common.empty')" />
    <slot v-else></slot>
  </template>
</template>
