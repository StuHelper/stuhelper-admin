<script setup lang="ts">
import type { GroupSummary } from './api';

import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Card, Tag } from 'ant-design-vue';

import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';

import { useGroupsAdmin } from './api';
import ListPanel from './ListPanel.vue';

/** QQ groups the viewer may manage, with what still needs attention in each. */
const { t } = useI18n();
const format = useFormat();
const api = useGroupsAdmin();
const columns = computed(() => [
  { key: 'name', title: t('page.groups.name') },
  { key: 'number', title: t('page.groups.number'), width: 120 },
  { key: 'members', title: t('page.groups.members'), width: 100 },
  { key: 'bot', title: t('page.groups.bot'), width: 110 },
  { key: 'student', title: t('page.groups.requireStudent'), width: 140 },
  { key: 'pending', title: t('page.groups.pending'), width: 110 },
]);
</script>

<template>
  <AdminPage :title="t('page.groups.title')" :description="t('page.groups.intro')">
    <Card :bordered="false">
      <ListPanel :columns="columns" :empty-text="t('page.groups.empty')" :loader="(cursor, signal) => api.groups(cursor, signal)" :row-key="(row: GroupSummary) => row.id">
        <template #cell="{ column, record }">
          <RouterLink v-if="column.key === 'name'" :to="`/qq/groups/${encodeURIComponent(record.id)}`">{{ record.name }}</RouterLink>
          <code v-else-if="column.key === 'number'" class="text-xs">{{ record.number }}</code>
          <template v-else-if="column.key === 'members'">{{ format.number(record.member_count) }}</template>
          <Tag v-else-if="column.key === 'bot'" :color="record.bot_enabled ? 'green' : 'default'">{{ t(record.bot_enabled ? 'page.groups.on' : 'page.groups.off') }}</Tag>
          <Tag v-else-if="column.key === 'student'" :color="record.require_student ? 'blue' : 'default'">{{ t(record.require_student ? 'page.groups.required' : 'page.groups.notRequired') }}</Tag>
          <template v-else-if="column.key === 'pending'">
            <Tag v-if="record.pending_count > 0" color="orange">{{ format.number(record.pending_count) }}</Tag>
            <span v-else class="text-muted-foreground">{{ t('page.groups.none') }}</span>
          </template>
        </template>
      </ListPanel>
    </Card>
  </AdminPage>
</template>
