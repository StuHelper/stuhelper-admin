<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { createFormatters, useI18n } from '@vben/locales';

import { useCustody } from '../composables/useCustody';

const { t, locale } = useI18n();
const { data, loading, sending, error, recovery, reload, resume, recover } = useCustody(true);
const format = computed(() => createFormatters(locale.value));
const locked = computed(() => loading.value || sending.value || !!recovery.value);
</script>

<template>
  <section class="custody-page">
    <h1>{{ t('page.custody.adminTitle') }}</h1>
    <p>{{ t('page.custody.adminDescription') }}</p>
    <nav class="controls" :aria-label="t('page.custody.navigation')">
      <RouterLink to="/contributions">{{ t('page.contribution.title') }}</RouterLink>
      <button :disabled="loading || sending" @click="reload('')">{{ t('page.custody.refresh') }}</button>
    </nav>
    <div role="status" aria-live="polite">
      <p v-if="loading || sending">{{ t(sending ? 'page.custody.sending' : 'page.custody.loading') }}</p>
      <p v-if="error">{{ t(`page.contribution.errors.${error}`) }}</p>
      <template v-if="recovery">
        <p>{{ t('page.custody.adminUncertain') }}</p>
        <button :disabled="loading || sending" @click="recover">{{ t('page.custody.retryRecovery') }}</button>
      </template>
    </div>
    <section v-if="data" :aria-label="t('page.custody.accounts')">
      <h2>{{ t('page.custody.accounts') }}</h2><p v-if="data.items.length === 0">{{ t('page.custody.empty') }}</p>
      <div class="inventory">
        <article v-for="item in data.items" :key="item.id" class="panel">
          <h3><bdi>{{ item.adapter }}</bdi></h3><p class="identifier"><bdi>{{ item.id }}</bdi></p>
          <p>{{ t(`page.custody.states.${item.state}`) }}</p>
          <p>{{ t('page.custody.requestUntil', { time: format.dateTime(item.authorization_expires_at) }) }}</p>
          <p v-if="item.last_error">{{ t(`page.custody.reasons.${item.last_error}`) }}</p>
          <div class="controls">
            <button v-if="item.state === 'pending' || item.state === 'blocked'" :disabled="locked" @click="resume(item)">{{ t('page.custody.resume') }}</button>
          </div>
        </article>
      </div>
      <button :disabled="locked || !data.next_cursor" @click="reload(data.next_cursor)">{{ t('page.custody.next') }}</button>
    </section>
  </section>
</template>

<style scoped>
.custody-page { max-width: 1000px; margin: auto; padding: 1.5rem; overflow-wrap: anywhere; }
h1,h2,h3 { font-weight: 650; margin-block: .75rem; }
h1 { font-size: 1.8rem; } h2 { font-size: 1.3rem; }
p { margin-block: .6rem; }
.panel { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: .7rem; padding: 1rem; margin-block: 1rem; }
.controls { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin-block: .75rem; }
.inventory { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 1rem; }
button { font: inherit; color: inherit; background: transparent; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: .3rem; min-height: 44px; padding: .5rem; max-width: 100%; }
button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
a { text-decoration: underline; } .identifier { font-size: .9rem; } :focus-visible { outline: 3px solid #3b82f6; outline-offset: 2px; }
</style>
