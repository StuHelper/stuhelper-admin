<script setup lang="ts">
import type { CatalogSchemas } from './catalog';

import { computed } from 'vue';

import { useI18n } from '@vben/locales';

import { Card, Descriptions, DescriptionsItem } from 'ant-design-vue';

import { standardFields } from './fieldSelectors';
import { profileFieldKey, supervisorKeys } from './profileRules';

const props = defineProps<{ source?: CatalogSchemas['TeacherHomepage'] }>();

const { t } = useI18n();
const textFields = standardFields.filter((field) => field !== 'photo' && field !== 'supervisors');

const staticValues = computed(() => {
  if (!props.source) return [];
  const source = props.source;
  return textFields.flatMap((field) => {
    const value = source[field];
    return typeof value === 'string' && value ? [{ label: t(profileFieldKey(field)), value }] : [];
  });
});
</script>

<template>
  <Card :bordered="false" :title="t('page.teacherHomepage.profile.source')">
    <template v-if="source">
      <Descriptions :column="1" size="small">
        <DescriptionsItem
          v-for="item in staticValues"
          :key="item.label"
          :label="item.label"
        >
          <div class="min-w-0 whitespace-pre-wrap break-words">{{ item.value }}</div>
        </DescriptionsItem>
        <DescriptionsItem
          v-if="source.supervisors.length > 0"
          :label="t('page.teacherHomepage.fields.supervisors')"
        >
          <ul class="flex flex-wrap gap-2">
            <li v-for="value in source.supervisors" :key="value">
              {{ t(`page.teacherHomepage.supervisors.${supervisorKeys[value]}`) }}
            </li>
          </ul>
        </DescriptionsItem>
        <DescriptionsItem
          v-for="({ label, value }, index) in source.fields"
          :key="`field-${index}`"
          :label="label"
        >
          <div class="min-w-0 whitespace-pre-wrap break-words">{{ value }}</div>
        </DescriptionsItem>
      </Descriptions>
      <details v-for="({ title, text }, index) in source.sections" :key="index" class="border-t py-2">
        <summary class="cursor-pointer font-medium">{{ title }}</summary>
        <div class="min-w-0 whitespace-pre-wrap break-words pt-2">{{ text }}</div>
      </details>
    </template>
    <p v-else class="text-muted-foreground">{{ t('page.teacherHomepage.profile.noSource') }}</p>
  </Card>
</template>
