<script setup lang="ts">
import { useI18n } from '@vben/locales';
defineProps<{busy?:boolean;empty?:boolean;error?:string;}>();
defineEmits<{retry:[]}>();
const {t}=useI18n();
</script>
<template>
  <p v-if="busy" role="status">{{ t('page.academic.loading') }}</p>
  <div v-else-if="error" class="admin-error" role="alert"><p>{{ t(`page.academic.errors.${error}`) }}</p><button type="button" @click="$emit('retry')">{{ t('page.academic.retry') }}</button></div>
  <p v-else-if="empty">{{ t('page.academic.empty') }}</p>
</template>
