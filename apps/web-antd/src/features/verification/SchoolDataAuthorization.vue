<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Button } from 'ant-design-vue';

import { useAsync } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import { useErrorText } from '#/shared/ui/messages';

import { useVerification } from './api';

const props = defineProps<{ credentialId: string }>();
const { t } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useVerification();
const denied = ref(false);
const { data, error, reload, status } = useAsync(
  (signal) =>
    api.get(
      'SchoolDataAuthorization',
      `/api/v1/admin/verification/credentials/${encodeURIComponent(props.credentialId)}/school-data`,
      signal,
    ),
  { onDenied: () => { denied.value = true; } },
);

const term = computed(() => {
  const through = data.value?.authorized_through;
  if (!through) return '';
  return t('page.verification.schoolData.term', {
    season: t(`page.verification.schoolData.seasons.${through.season}`),
    year: format.value.number(through.year, { useGrouping: false }),
  });
});

watch(() => props.credentialId, () => {
  denied.value = false;
  void reload();
}, { immediate: true });
</script>

<template>
  <div v-if="!denied" aria-live="polite">
    <dl v-if="data" class="mb-3 grid gap-1 text-sm">
      <div class="flex flex-wrap gap-x-2">
        <dt class="text-muted-foreground">{{ t('page.verification.schoolData.statusLabel') }}</dt>
        <dd>{{ t(`page.verification.schoolData.states.${data.state}`) }}</dd>
      </div>
      <div v-if="term" class="flex flex-wrap gap-x-2">
        <dt class="text-muted-foreground">{{ t('page.verification.schoolData.throughLabel') }}</dt>
        <dd>{{ term }}</dd>
      </div>
    </dl>
    <p v-else-if="status === 'loading'" class="mb-3 text-sm text-muted-foreground">
      {{ t('page.verification.schoolData.loading') }}
    </p>
    <div v-else-if="status === 'error'" class="mb-3 flex items-center gap-2">
      <span>{{ errorText(error) }}</span>
      <Button size="small" @click="reload">{{ t('page.common.retry') }}</Button>
    </div>
  </div>
</template>
