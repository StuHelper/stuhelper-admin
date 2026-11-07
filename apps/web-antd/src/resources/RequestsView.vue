<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Button, Space, Tag } from 'ant-design-vue';

import { tagColor } from '#/console-ui';

import { query, type Schema, segment } from './api';
import RequestForm from './RequestForm.vue';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';

import './resources.css';
const { t, d } = useI18n();
const after = ref('');
const appeal = ref(false);
const items = ref<Schema['RequestReceipt'][]>([]);
const next = ref('');
const selected = ref<Schema['RequestReceipt']>();
const state = useResources(() => {
  items.value = [];
  selected.value = undefined;
});
const { busy, error, uncertain } = state;
function load() {
  void state.run(async () => {
    const page = await state.client.json(
      '/requests' + query({ after: after.value, limit: '25' }),
      'RequestPage',
      { signal: state.signal },
    );
    items.value = page.items;
    next.value = page.next_cursor;
  });
}
function open(id: string) {
  appeal.value = false;
  void state.run(async () => {
    selected.value = await state.client.json(
      '/requests/' + segment(id),
      'RequestReceipt',
      { signal: state.signal },
    );
  });
}
function retry() {
  void state.run(async () => {
    if (selected.value)
      selected.value = await state.mutation.run(
        '/requests/' + segment(selected.value.id) + '/retry',
        'RequestReceipt',
        {},
      );
  });
}
load();
</script>
<template>
  <Page :title="t('page.resources.myRequests')">
    <template #extra><RouterLink to="/resources/me">{{ t('page.resources.mine') }}</RouterLink></template>
    <section class="resources-page">
      <StatusBlock :busy="busy" :error="error" :empty="items.length === 0" @retry="state.retry" />
      <div class="resource-columns">
        <ul class="resource-list">
          <li v-for="item in items" :key="item.id" class="resource-card" :class="{ 'is-selected': selected?.id === item.id }">
            <div class="console-row-head"><h2>{{ t(`page.resources.requestKinds.${item.kind}`) }}</h2><time class="resource-muted">{{ d(new Date(item.created_at), 'date') }}</time></div>
            <Button type="link" size="small" :disabled="busy || uncertain" @click="open(item.id)">{{ t('page.resources.checkStatus') }}</Button>
          </li>
        </ul>
        <section v-if="selected" class="resource-card resource-form console-detail">
          <p role="status"><Tag :color="tagColor(selected.state)">{{ t(`page.resources.states.${selected.state}`) }}</Tag></p>
          <p>{{ selected.decision_reason }}</p>
          <Space wrap>
            <RouterLink :to="`/resources/items/${selected.resource_id}`">{{ t('page.resources.view') }}</RouterLink>
            <Button v-if="selected.state === 'failed'" :disabled="busy" @click="retry">{{ t('page.resources.retry') }}</Button>
            <Button v-if="selected.can_appeal" @click="appeal = true">{{ t('page.resources.appeal') }}</Button>
          </Space>
          <RequestForm v-if="appeal && selected.resource_id && selected.task_id" :key="selected.id" :resource-id="selected.resource_id" :previous-task-id="selected.task_id" @saved="appeal = false; load();" />
        </section>
      </div>
      <Button v-if="next" class="justify-self-start" :disabled="busy || uncertain" @click="after = next; load();">{{ t('page.resources.more') }}</Button>
    </section>
  </Page>
</template>
