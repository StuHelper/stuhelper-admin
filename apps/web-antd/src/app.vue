<script lang="ts" setup>
import { computed } from 'vue';

import { useAntdDesignTokens } from '@vben/hooks';
import { preferences, usePreferences } from '@vben/preferences';

import { App, ConfigProvider, theme } from 'ant-design-vue';

import { antdLocale } from '#/locales';

defineOptions({ name: 'App' });

const direction = computed(() => preferences.app.locale === 'ar-EG' ? 'rtl' : 'ltr');
const { isDark } = usePreferences();
const { tokens } = useAntdDesignTokens();

const tokenTheme = computed(() => {
  const algorithm = isDark.value
    ? [theme.darkAlgorithm]
    : [theme.defaultAlgorithm];

  // antd 紧凑模式算法
  if (preferences.app.compact) {
    algorithm.push(theme.compactAlgorithm);
  }

  return {
    algorithm,
    // Softer motion and rounder corners than the Ant Design defaults, at a compact size.
    token: { ...tokens, borderRadius: 8, controlHeight: 32, fontSize: 14, motionDurationMid: '0.25s', motionEaseOut: 'cubic-bezier(.22, 1, .36, 1)', wireframe: false },
  };
});
</script>

<template>
  <ConfigProvider :locale="antdLocale" :direction="direction" :theme="tokenTheme" :auto-insert-space-in-button="false">
    <App>
      <RouterView />
    </App>
  </ConfigProvider>
</template>
