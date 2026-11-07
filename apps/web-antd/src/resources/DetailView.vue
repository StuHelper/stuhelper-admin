<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Alert, Button, Descriptions, DescriptionsItem, Space, Tag } from 'ant-design-vue';

import { tagColor } from '#/console-ui';

import { name, type Resource, type Schema, segment, shown } from './api';
import RequestForm from './RequestForm.vue';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';

import './resources.css';
const entry = ref<Resource>();
const receipt = ref<Schema['RequestReceipt']>();
const route = useRoute();
const { t, locale, n, d } = useI18n();
const showRequest = ref(false);
const state = useResources(() => {
  entry.value = undefined;
  receipt.value = undefined;
});
const { busy, error } = state;
const version = computed(() => entry.value?.current ?? entry.value?.proposal);
function load() {
  void state.run(async () => {
    entry.value = await state.client.json(
      '/items/' + segment(String(route.params.id)),
      'Resource',
      { signal: state.signal },
    );
  });
}
function download() {
  if (!entry.value?.current?.file) return;
  const file = entry.value.current.file;
  void state.run(() =>
    state.client.download(
      '/items/' + segment(entry.value?.id ?? '') + '/download',
      file.filename,
      file.size,
      state.signal,
    ),
  );
}
watch(
  () => route.params.id,
  () => {
    entry.value = undefined;
    showRequest.value = false;
    load();
  },
  { immediate: true },
);
</script>
<template>
  <Page :title="version?.metadata.title ?? t('page.resources.title')">
    <template #extra><RouterLink to="/resources">{{ t('page.resources.title') }}</RouterLink></template>
    <section class="resources-page">
      <StatusBlock :busy="busy" :error="error" @retry="state.retry" />
      <template v-if="entry && version">
        <article class="resource-card resource-form">
          <h1 class="text-lg font-semibold">{{ version.metadata.title }}</h1>
          <Space wrap>
            <Tag>{{ name(version.category.names, locale) }}</Tag>
            <Tag :color="tagColor(version.state)">{{ t(`page.resources.states.${version.state}`) }}</Tag>
            <time class="resource-muted">{{ d(new Date(version.created_at), 'date') }}</time>
          </Space>
          <p class="resource-details">{{ version.metadata.description }}</p>
          <Descriptions :column="{ xs: 1, md: 2 }" size="small" bordered>
            <DescriptionsItem v-for="field in version.category.fields" :key="field.key" :label="name(field.names, locale)">{{ shown(field, version.metadata.attributes[field.key], locale) || t('page.resources.unknown') }}</DescriptionsItem>
            <DescriptionsItem :label="t('page.resources.origin')">{{ t(`page.resources.origins.${version.metadata.origin.kind}`) }}</DescriptionsItem>
            <DescriptionsItem v-if="version.metadata.origin.source" :label="t('page.resources.source')">{{ version.metadata.origin.source }}</DescriptionsItem>
            <DescriptionsItem v-if="version.metadata.origin.author" :label="t('page.resources.author')">{{ version.metadata.origin.author }}</DescriptionsItem>
            <DescriptionsItem v-if="version.metadata.origin.license" :label="t('page.resources.license')">{{ version.metadata.origin.license }}</DescriptionsItem>
          </Descriptions>
          <p v-if="version.file">{{ version.file.filename }} {{ n(version.file.size) }} {{ t('page.resources.bytes') }}</p>
          <Alert v-if="entry.proposal && entry.current" type="info" show-icon role="status" :message="t('page.resources.oldVersionContinues')" />
          <Alert v-if="!entry.download_allowed" type="warning" show-icon :message="t('page.resources.accessRequired')" />
          <Space wrap>
            <Button v-if="entry.download_allowed" type="primary" :disabled="busy" @click="download">{{ t('page.resources.download') }}</Button>
            <RouterLink v-if="entry.owned" :to="`/resources/items/${entry.id}/edit`">{{ t('page.resources.edit') }}</RouterLink>
            <span v-if="version.metadata.associations.course_id">{{ t('page.resources.catalog.course') }} {{ version.metadata.associations.course_id }}</span>
            <Button @click="showRequest = !showRequest">{{ t('page.resources.request') }}</Button>
          </Space>
        </article>
        <section v-if="showRequest" class="resource-card">
          <RequestForm :resource-id="entry.id" :owned="entry.owned" @saved="receipt = $event" />
          <RouterLink v-if="receipt" to="/resources/requests">{{ t('page.resources.myRequests') }}</RouterLink>
        </section>
      </template>
    </section>
  </Page>
</template>
