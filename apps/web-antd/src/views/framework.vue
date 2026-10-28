<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Alert, Button, Card } from 'ant-design-vue';

import { usePlatform } from '#/composables/usePlatform';

const { t } = useI18n();
const { state, error, reload } = usePlatform({ admin: true });
const description = computed(() => {
  if (state.value === 'loading') return t('page.framework.loading');
  if (state.value === 'ready') return t('page.framework.ready');
  switch (error.value) {
    case 'forbidden': { return t('page.framework.errors.forbidden');
    }
    case 'identity': { return t('page.framework.errors.identity');
    }
    case 'incompatible': { return t('page.framework.errors.incompatible');
    }
    case 'unauthenticated': { return t('page.framework.errors.unauthenticated');
    }
    default: { return t('page.framework.errors.network');
    }
  }
});
</script>

<template>
  <Page :title="t('page.framework.title')" :description="t('page.framework.description')">
    <Card :title="t('page.framework.status')" :bordered="false">
      <div role="status" aria-live="polite">
        <Alert :message="description" :type="state === 'ready' ? 'success' : 'info'" show-icon />
      </div>
      <Button class="mt-4" :loading="state === 'loading'" @click="reload">{{ t('page.framework.retry') }}</Button>
      <RouterLink class="ms-4" to="/verification">{{ t('page.verification.adminTitle') }}</RouterLink>
    </Card>
  </Page>
</template>
