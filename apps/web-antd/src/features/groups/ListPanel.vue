<script setup lang="ts" generic="T extends object">
import type { PageResult } from '#/shared/composables/async';

import { onMounted } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Table } from 'ant-design-vue';

import { usePaged } from '#/shared/composables/async';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';

// One cursor-paged table of a group collection. The server orders each
// collection; this panel only appends pages and keeps shown rows when a later
// page fails.
const props = defineProps<{
  columns: { dataIndex?: string; key: string; title: string; width?: number }[];
  emptyText: string;
  loader: (cursor: string, signal: AbortSignal) => Promise<PageResult<T>>;
  rowKey: (row: T) => string;
}>();
const { t } = useI18n();
const errorText = useErrorText();
const rows = usePaged<T>(props.loader);
onMounted(rows.reload);
defineExpose({ reload: rows.reload });
</script>

<template>
  <LoadState
    v-if="rows.items.value.length === 0"
    :status="rows.status.value === 'idle' ? 'loading' : rows.status.value"
    :error="rows.error.value"
    :empty="true"
    :empty-text="emptyText"
    @retry="rows.reload"
  />
  <template v-else>
    <Table :columns="columns" :data-source="rows.items.value" :pagination="false" :row-key="rowKey" size="small" :scroll="{ x: 720 }">
      <template #bodyCell="slot">
        <slot name="cell" v-bind="slot"></slot>
      </template>
    </Table>
    <Alert v-if="rows.error.value" class="mt-3" type="error" show-icon :message="errorText(rows.error.value)" />
    <div class="mt-4 flex justify-center">
      <Button v-if="rows.next.value" :loading="rows.appending.value" @click="rows.loadMore">{{ t('page.common.loadMore') }}</Button>
    </div>
  </template>
</template>
