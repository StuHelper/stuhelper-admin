<script setup lang="ts">
import { useI18n } from '@vben/locales';

import { Button } from 'ant-design-vue';

const props = defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ confirm: [] }>();
const { t } = useI18n();

function confirmCancellation() {
  if (!props.disabled && window.confirm(t('page.verification.cancelPending.confirm'))) emit('confirm');
}
</script>

<template>
  <Button html-type="button" :disabled="disabled" @click="confirmCancellation">
    {{ t('page.verification.cancelPending.action') }}
  </Button>
</template>
