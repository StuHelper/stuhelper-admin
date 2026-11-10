<script setup lang="ts">
import { useI18n } from '@vben/locales';

import { Alert, Button, Skeleton } from 'ant-design-vue';

import { useErrorText } from '#/shared/ui/messages';

import { useCampus } from './campus';

// Shown until the served university is known. A failure offers one clear retry.
const emit = defineEmits<{ ready: [id: string] }>();
const { t } = useI18n();
const errorText = useErrorText();
const campus = useCampus();
async function retry() {
  await campus.load();
  if (campus.status.value === 'ready') emit('ready', campus.id.value);
}
</script>

<template>
  <Alert
    v-if="campus.status.value === 'error'"
    type="error"
    show-icon
    role="alert"
    :message="errorText(campus.failure.value)"
  >
    <template #action>
      <Button size="small" @click="retry">{{ t('page.common.reloadCampus') }}</Button>
    </template>
  </Alert>
  <Skeleton v-else active :paragraph="{ rows: 2 }" />
</template>
