<script setup lang="ts">
import { useI18n } from '@vben/locales';

import { Alert, Button, Spin } from 'ant-design-vue';
defineProps<{ busy?: boolean; empty?: boolean; error?: string }>();
defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>
<template>
  <div v-if="busy" class="console-status" role="status"><Spin size="small" /><span>{{ t('page.resources.loading') }}</span></div>
  <Alert v-else-if="error" type="error" show-icon :message="t(`page.resources.errors.${error}`)">
    <template #action><Button size="small" @click="$emit('retry')">{{ t('page.resources.retry') }}</Button></template>
  </Alert>
  <p v-else-if="empty" role="status" class="resource-muted">{{ t('page.resources.empty') }}</p>
</template>
