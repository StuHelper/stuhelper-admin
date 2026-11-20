<script setup lang="ts">
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Result } from 'ant-design-vue';

defineProps<{ disabled?: boolean }>();
const { t } = useI18n();
</script>

<template>
  <Result
    :status="disabled ? 'info' : '404'"
    :title="t(disabled ? 'page.errors.disabled' : 'page.framework.unavailable')"
    :sub-title="disabled ? undefined : t('page.notFound.description')"
  >
    <template #extra>
      <RouterLink to="/">{{ t('page.notFound.home') }}</RouterLink>
    </template>
  </Result>
</template>
