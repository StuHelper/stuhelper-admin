<script setup lang="ts">
import type { ViolationCategory } from './violationCategories';

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Card, Space, Tag } from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useErrorText } from '#/shared/ui/messages';

import { type QueueSummary, useAcademicAdmin } from './api';
import { violationCategories } from './violationCategories';

/**
 * The school's waiting tasks per violation category. Counts cover the whole school
 * queue; choosing a category applies it to the queue filter on this page.
 */
const props = defineProps<{ active?: string; school: string; }>();
const emit = defineEmits<{ pick: [category: '' | ViolationCategory] }>();
const { t } = useI18n();
const errorText = useErrorText();
const api = useAcademicAdmin();
const summary = shallowRef<QueueSummary>();
const error = ref('');
let controller: AbortController | undefined;

async function load() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  error.value = '';
  if (!props.school) return;
  try {
    const value = await api.queueSummary(props.school, current.signal);
    if (!current.signal.aborted) summary.value = value;
  } catch (error_) {
    if (!current.signal.aborted) error.value = errorCode(error_);
  }
}
watch(() => props.school, () => { summary.value = undefined; void load(); }, { immediate: true });
onBeforeUnmount(() => controller?.abort());
defineExpose({ reload: load });

// Contract order, non-zero categories only; tasks without a category stay in the waiting total.
const rows = computed(() => {
  const counts = summary.value?.by_category ?? {};
  return violationCategories.filter((code) => (counts[code] ?? 0) > 0).map((code) => ({ code, count: counts[code] ?? 0 }));
});
</script>

<template>
  <Card :bordered="false" size="small" :title="t('page.moderation.categorySummary')">
    <p v-if="error" class="text-destructive" role="alert">
      {{ errorText(error) }}
      <Button type="link" size="small" @click="load">{{ t('page.common.retry') }}</Button>
    </p>
    <p v-else-if="!summary" class="text-muted-foreground text-sm" aria-busy="true">{{ t('page.common.loading') }}</p>
    <template v-else>
      <p class="text-muted-foreground mb-2 text-sm">{{ t('page.moderation.categorySummaryWaiting', { count: summary.waiting }) }}</p>
      <p v-if="rows.length === 0" class="text-muted-foreground text-sm">{{ t('page.moderation.categorySummaryEmpty') }}</p>
      <Space v-else wrap>
        <Button
          v-for="row in rows"
          :key="row.code"
          size="small"
          :type="active === row.code ? 'primary' : 'default'"
          :aria-pressed="active === row.code"
          @click="emit('pick', active === row.code ? '' : row.code)"
        >
          {{ t(`page.moderation.categories.${row.code}`) }}
          <Tag class="ms-1" :bordered="false">{{ row.count }}</Tag>
        </Button>
      </Space>
    </template>
  </Card>
</template>
