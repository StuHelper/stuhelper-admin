<script setup lang="ts">
import { useI18n } from '@vben/locales'

import { useSession } from '../shared/session'

const { t } = useI18n()
const session = useSession()
</script>

<template>
  <span v-if="session.unavailable.value && session.session.value" role="status">
    {{ t('page.session.unavailable') }}
    <button type="button" @click="session.reload">{{ t('page.common.retry') }}</button>
  </span>
</template>
