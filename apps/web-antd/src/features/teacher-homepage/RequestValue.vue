<script setup lang="ts">
import type { CatalogSchemas } from './catalog';

import { useI18n } from '@vben/locales';

import { supervisorKeys } from './profileRules';

defineProps<{ value: CatalogSchemas['TeacherHomepageFieldValue'] }>();

const { t } = useI18n();
</script>

<template>
  <div v-if="value.text !== undefined" class="whitespace-pre-wrap break-words" dir="auto">
    {{ value.text }}
  </div>
  <ul v-else-if="value.supervisors?.length" class="list-inside list-disc">
    <li v-for="item in value.supervisors" :key="item">
      {{ t(`page.teacherHomepage.supervisors.${supervisorKeys[item]}`) }}
    </li>
  </ul>
  <dl v-else-if="value.fields?.length" class="flex flex-col gap-2">
    <div v-for="(item, index) in value.fields" :key="index">
      <dt class="font-medium" dir="auto">{{ item.label }}</dt>
      <dd class="whitespace-pre-wrap break-words" dir="auto">{{ item.value }}</dd>
    </div>
  </dl>
  <dl v-else-if="value.sections?.length" class="flex flex-col gap-2">
    <div v-for="(item, index) in value.sections" :key="index">
      <dt class="font-medium" dir="auto">{{ item.title }}</dt>
      <dd class="whitespace-pre-wrap break-words" dir="auto">{{ item.text }}</dd>
    </div>
  </dl>
  <p v-else>{{ t('page.teacherHomepage.requests.groupCleared') }}</p>
</template>
