<script setup lang="ts">
import { BasicLayout } from '@vben/layouts';
import { useI18n } from '@vben/locales';
const { t } = useI18n();
</script>

<template>
  <BasicLayout>
    <template #user-dropdown>
      <span class="text-muted-foreground me-4 hidden text-xs sm:inline">{{ t('page.framework.preview') }}</span>
    </template>
  </BasicLayout>
</template>
