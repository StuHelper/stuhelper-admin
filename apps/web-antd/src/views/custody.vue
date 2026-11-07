<script setup lang="ts">
import { computed } from 'vue';

import { Page } from '@vben/common-ui';
import { createFormatters, useI18n } from '@vben/locales';

import { Button, Tag } from 'ant-design-vue';

import { tagColor } from '#/console-ui';

import { useCustody } from '../composables/useCustody';

const { t, locale } = useI18n();
const { data, loading, sending, error, recovery, reload, resume, recover } = useCustody(true);
const format = computed(() => createFormatters(locale.value));
const locked = computed(() => loading.value || sending.value || !!recovery.value);
</script>

<template>
  <Page :title="t('page.custody.adminTitle')" :description="t('page.custody.adminDescription')">
  <section class="custody-page">
    <nav class="console-controls" :aria-label="t('page.custody.navigation')">
      <Button :loading="loading" :disabled="sending" @click="reload('')">{{ t('page.custody.refresh') }}</Button>
    </nav>
    <div role="status" aria-live="polite">
      <p v-if="loading || sending">{{ t(sending ? 'page.custody.sending' : 'page.custody.loading') }}</p>
      <p v-if="error">{{ t(`page.contribution.errors.${error}`) }}</p>
      <template v-if="recovery">
        <p>{{ t('page.custody.adminUncertain') }}</p>
        <Button type="primary" :disabled="loading || sending" @click="recover">{{ t('page.custody.retryRecovery') }}</Button>
      </template>
    </div>
    <section v-if="data" :aria-label="t('page.custody.accounts')">
      <h2 class="mb-3 font-semibold">{{ t('page.custody.accounts') }}</h2><p v-if="data.items.length === 0">{{ t('page.custody.empty') }}</p>
      <div class="console-inventory">
        <article v-for="item in data.items" :key="item.id" class="console-entry">
          <div class="console-row-head"><h3><bdi>{{ item.adapter }}</bdi></h3><Tag :color="tagColor(item.state)">{{ t(`page.custody.states.${item.state}`) }}</Tag></div><p class="console-identifier"><bdi>{{ item.id }}</bdi></p>
          <p>{{ t('page.custody.requestUntil', { time: format.dateTime(item.authorization_expires_at) }) }}</p>
          <p v-if="item.last_error">{{ t(`page.custody.reasons.${item.last_error}`) }}</p>
          <div class="console-controls">
            <Button v-if="item.state === 'pending' || item.state === 'blocked'" type="primary" :disabled="locked" @click="resume(item)">{{ t('page.custody.resume') }}</Button>
          </div>
        </article>
      </div>
      <Button class="mt-4" :disabled="locked || !data.next_cursor" @click="reload(data.next_cursor)">{{ t('page.custody.next') }}</Button>
    </section>
  </section>
  </Page>
</template>
