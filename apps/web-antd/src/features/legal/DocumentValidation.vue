<script setup lang="ts">
import type { ValidationIssue } from './api';

import { useI18n } from '@vben/locales';

import { Alert } from 'ant-design-vue';

defineProps<{ issues: ValidationIssue[] }>();

const { t, te } = useI18n();
function issueText(code: string) {
  const key = `page.legal.validation.${code}`;
  return t(te(key) ? key : 'page.legal.validation.unknown');
}
</script>

<template>
  <Alert type="error" show-icon role="alert" :message="t('page.legal.documents.validation')">
    <template #description>
      <ul class="list-disc ps-5">
        <li v-for="issue in issues" :key="`${issue.code}/${issue.key ?? ''}`">
          {{ issueText(issue.code) }}
          <bdi v-if="issue.key" class="break-all font-mono">{{ issue.key }}</bdi>
        </li>
      </ul>
    </template>
  </Alert>
</template>
