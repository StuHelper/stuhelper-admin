<script setup lang="ts">
import { RouterLink } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Tag } from 'ant-design-vue';

import { availableSettings, plannedSettings } from '#/navigation';
import { prototypePathOf, prototypesEnabled } from '#/prototypes';

const { t } = useI18n();
</script>

<template>
  <Page :title="t('page.settings.title')" :description="t('page.settings.description')">
    <section class="settings-section">
      <h2>{{ t('page.settings.available') }}</h2>
      <div class="settings-grid">
        <RouterLink v-for="item in availableSettings" :key="item.key" class="settings-card" :to="item.path">
          <strong>{{ t(`page.settings.items.${item.key}.title`) }}</strong>
          <span>{{ t(`page.settings.items.${item.key}.summary`) }}</span>
        </RouterLink>
      </div>
    </section>
    <section class="settings-section">
      <h2>{{ t('page.settings.planned') }}</h2>
      <p>{{ t('page.settings.plannedHint') }}</p>
      <div class="settings-grid">
        <component :is="prototypesEnabled ? RouterLink : 'article'" v-for="key in plannedSettings" :key="key" class="settings-card planned" :to="prototypesEnabled ? prototypePathOf[key] : undefined">
          <strong>{{ t(`page.settings.items.${key}.title`) }}</strong>
          <span>{{ t(`page.settings.items.${key}.summary`) }}</span>
          <Tag class="settings-tag">{{ t('page.settings.notConnected') }}</Tag>
        </component>
      </div>
    </section>
  </Page>
</template>

<style scoped>
.settings-section { margin-block-end: 1.75rem; }
.settings-section h2 { margin: 0 0 .75rem; font-size: 1rem; font-weight: 600; }
.settings-section p { margin: 0 0 .75rem; color: hsl(var(--muted-foreground)); }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); gap: .75rem; }
.settings-card { display: grid; align-content: start; gap: .35rem; padding: 1rem; border: 1px solid hsl(var(--border)); border-radius: .5rem; background: hsl(var(--card)); color: hsl(var(--foreground)); }
.settings-card span { font-size: .85rem; color: hsl(var(--muted-foreground)); }
a.settings-card:hover, a.settings-card.planned:hover { border-color: hsl(var(--primary)); }
a.settings-card:focus-visible { outline: 2px solid hsl(var(--primary)); outline-offset: 2px; }
.settings-card.planned { background: transparent; }
.settings-tag { justify-self: start; margin-block-start: .25rem; }
</style>
