<script setup lang="ts">
import { useI18n } from '@vben/locales';
defineProps<{ busy?: boolean; empty?: boolean; error?: string }>();
defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>
<template>
  <p v-if="busy" role="status">
    {{ t('page.resources.loading') }}
  </p>
  <div v-else-if="error" role="alert">
    <p>{{ t(`page.resources.errors.${error}`) }}</p>
    <button @click="$emit('retry')">
      {{ t('page.resources.retry') }}
    </button>
  </div>
  <p v-else-if="empty" role="status">
    {{ t('page.resources.empty') }}
  </p>
</template>
