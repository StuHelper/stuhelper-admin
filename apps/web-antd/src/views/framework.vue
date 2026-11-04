<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { Page } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';
import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Tag } from 'ant-design-vue';

import { usePlatform } from '#/composables/usePlatform';
import { quickLinks } from '#/navigation';

const { t } = useI18n();
const { state, error, modules, reload } = usePlatform({ admin: true });
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
const alertType = computed(() => {
  if (state.value === 'ready') return 'success';
  return state.value === 'loading' ? 'info' : 'warning';
});
const stateColor = (value: string) => ({ ready: 'success', failed: 'error', starting: 'processing', stopping: 'processing' })[value] ?? 'default';
</script>

<template>
  <Page :title="t('page.framework.title')" :description="t('page.framework.description')">
    <div class="dashboard">
      <section :aria-label="t('page.framework.shortcuts')" class="shortcut-grid">
        <RouterLink v-for="item in quickLinks" :key="item.path" class="shortcut" :to="item.path">
          <IconifyIcon :icon="item.icon" class="shortcut-icon" />
          <span>{{ t(item.title) }}</span>
        </RouterLink>
      </section>
      <Card :title="t('page.framework.status')" :bordered="false">
        <template #extra>
          <Button size="small" :loading="state === 'loading'" @click="reload">{{ t('page.framework.retry') }}</Button>
        </template>
        <div role="status" aria-live="polite">
          <Alert :message="description" :type="alertType" show-icon />
        </div>
        <ul v-if="modules.length > 0" class="module-list">
          <li v-for="item in modules" :key="item.id">
            <bdi>{{ item.id }}</bdi>
            <Tag :color="stateColor(item.state)">{{ t(`page.framework.moduleStates.${item.state}`) }}</Tag>
          </li>
        </ul>
      </Card>
    </div>
  </Page>
</template>

<style scoped>
.dashboard { display: grid; gap: 1rem; }
.shortcut-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr)); gap: .75rem; }
.shortcut { display: flex; align-items: center; gap: .75rem; min-height: 4rem; padding: .75rem 1rem; border: 1px solid hsl(var(--border)); border-radius: .5rem; background: hsl(var(--card)); color: hsl(var(--foreground)); font-weight: 500; }
.shortcut:hover { border-color: hsl(var(--primary)); }
.shortcut:focus-visible { outline: 2px solid hsl(var(--primary)); outline-offset: 2px; }
.shortcut-icon { flex: none; width: 1.25rem; height: 1.25rem; color: hsl(var(--primary)); }
.module-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr)); gap: .5rem; margin: 1rem 0 0; padding: 0; list-style: none; }
.module-list li { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .5rem .75rem; border: 1px solid hsl(var(--border)); border-radius: .375rem; }
</style>
