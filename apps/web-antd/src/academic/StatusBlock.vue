<script setup lang="ts">
import { useI18n } from '@vben/locales';

import { Alert, Button, Empty, Spin } from 'ant-design-vue';

defineProps<{busy?:boolean;empty?:boolean;error?:string;}>();
defineEmits<{retry:[]}>();
const {t}=useI18n();
</script>
<template>
  <div v-if="busy" class="console-status" role="status"><Spin size="small" /><span>{{ t('page.academic.loading') }}</span></div>
  <Alert v-else-if="error" type="error" show-icon :message="t(`page.academic.errors.${error}`)">
    <template #action><Button size="small" @click="$emit('retry')">{{ t('page.academic.retry') }}</Button></template>
  </Alert>
  <Empty v-else-if="empty" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.academic.empty')" />
</template>
