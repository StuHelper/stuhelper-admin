<script setup lang="ts">
import type { GroupConfig } from './api';

import { shallowRef, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Card } from 'ant-design-vue';

import AdminPage from '#/shared/ui/AdminPage.vue';

import { useGroupsAdmin } from './api';
import ConfigPanel from './ConfigPanel.vue';

/** Rules of one group on their own page, apart from the member and action records. */
const props = defineProps<{ id: string }>();
const { t } = useI18n();
const api = useGroupsAdmin();
const config = shallowRef<GroupConfig>();
let configSeq = 0;
watch(
  () => props.id,
  async (id) => {
    const seq = ++configSeq;
    config.value = undefined;
    try {
      const loaded = await api.config(id);
      if (seq === configSeq) config.value = loaded;
    } catch {
      // The settings form reports its own loading failure.
    }
  },
  { immediate: true },
);
</script>

<template>
  <AdminPage :title="config?.name ?? t('page.groups.tabs.config')" :description="t('page.groups.tabs.config')">
    <RouterLink :to="`/qq/groups/${encodeURIComponent(id)}`" class="mb-3 inline-block">{{ t('page.groups.backToGroup') }}</RouterLink>
    <Card :bordered="false">
      <ConfigPanel :key="id" :group="id" @saved="config = $event" />
    </Card>
  </AdminPage>
</template>
