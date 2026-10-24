<script setup lang="ts">
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';
const { t } = useI18n();

import { Result } from 'ant-design-vue';
</script>

<template>
  <Result status="404" :title="t('page.framework.unavailable')" :sub-title="t('page.notFound.description')">
    <template #extra><RouterLink to="/">{{ t('page.notFound.home') }}</RouterLink></template>
  </Result>
</template>
