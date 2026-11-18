<script setup lang="ts">
import type { Component } from 'vue';

import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Table, Tag } from 'ant-design-vue';
import {
  BadgeCheck,
  CircleAlert,
  FileCheck,
  HardDrive,
  MessageSquare,
} from 'lucide-vue-next';

import { ApiError } from '#/shared/api/errors';
import { useHostFetch } from '#/shared/api/transport';
import { useAsync } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import { useHttp, useSession } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';

import { useAcademicAdmin } from '../academic/api';
import { useCampus } from '../academic/campus';
import { storageAPI, StorageError } from '../storage/api';
import { VerificationApi } from '../verification/api';
import { getModules } from './api';

// Work first, system health second. Each count is fetched with the administrator's
// own permissions: a refused count hides its card, a failed one offers a retry.
const { t, te } = useI18n();
const format = useFormat();
const http = useHttp();
const session = useSession();
const fetcher = useHostFetch();
const moderation = useAcademicAdmin();
const verification = new VerificationApi(http);
const campus = useCampus();
const modules = useAsync((signal) => getModules(http, signal));
const countLimit = 100;
const showStatus = ref(false);

interface Todo {
  count: number | undefined;
  icon: Component;
  key: string;
  to: string;
}

const countOf = (rows: unknown[]) => rows.length;
const refused = (reason: unknown) =>
  (reason instanceof ApiError && reason.denied) ||
  (reason instanceof StorageError &&
    (reason.code === 'forbidden' || reason.code === 'unauthenticated'));
const campusDenied = () =>
  campus.failure.value === 'forbidden' ||
  campus.failure.value === 'unauthenticated';

const todos = useAsync(async (signal) => {
  const id = campus.id.value;
  const tasks = (state: string, kind?: string) =>
    moderation.tasks(
      { school_id: id, state, content_kind: kind, limit: countLimit },
      signal,
    );
  const schoolSources: {
    icon: Component;
    key: string;
    load: () => Promise<number>;
    to: string;
  }[] = [
    {
      key: 'moderation',
      to: '/moderation/queue',
      icon: MessageSquare,
      load: async () => {
        const rows = await tasks('waiting');
        return countOf(rows.filter((row) => row.content_kind !== 'resource'));
      },
    },
    {
      key: 'resources',
      to: '/resources/reviews',
      icon: FileCheck,
      load: async () => countOf(await tasks('waiting', 'resource')),
    },
    {
      key: 'failed',
      to: '/moderation/queue',
      icon: CircleAlert,
      load: async () => countOf(await tasks('failed')),
    },
    {
      key: 'verification',
      to: '/verification',
      icon: BadgeCheck,
      load: async () => {
        const page = await verification.list(
          'Application',
          `/api/v1/admin/verification/schools/${encodeURIComponent(id)}/applications`,
          { signal },
        );
        return page.items.filter((row) => row.state === 'pending_review').length;
      },
    },
  ];
  const storageSource = {
    key: 'storage',
    to: '/storage',
    icon: HardDrive,
    load: async () => {
      try {
        const value = await storageAPI(fetcher).read(signal);
        return value.jobs.blocked;
      } catch (error) {
        if (error instanceof StorageError && error.code === 'unauthenticated') {
          session.invalidate();
        }
        throw error;
      }
    },
  };

  const items: Todo[] = [];
  let failed = false;

  if (id) {
    const settled = await Promise.allSettled([
      ...schoolSources.map((source) => source.load()),
      storageSource.load(),
    ]);
    const allSources = [...schoolSources, storageSource];
    settled.forEach((result, index) => {
      const source = allSources[index];
      if (!source) return;
      if (result.status === 'fulfilled') {
        items.push({
          key: source.key,
          to: source.to,
          icon: source.icon,
          count: result.value,
        });
      } else if (!refused(result.reason)) {
        failed = true;
        items.push({
          key: source.key,
          to: source.to,
          icon: source.icon,
          count: undefined,
        });
      }
    });
  } else {
    if (campus.status.value === 'error' && !campusDenied()) {
      failed = true;
      for (const source of schoolSources) {
        items.push({
          key: source.key,
          to: source.to,
          icon: source.icon,
          count: undefined,
        });
      }
    }
    try {
      const blocked = await storageSource.load();
      items.push({
        key: storageSource.key,
        to: storageSource.to,
        icon: storageSource.icon,
        count: blocked,
      });
    } catch (error) {
      if (!refused(error)) {
        failed = true;
        items.push({
          key: storageSource.key,
          to: storageSource.to,
          icon: storageSource.icon,
          count: undefined,
        });
      }
    }
  }
  return { items, failed };
});

const recent = useAsync((signal) =>
  campus.id.value
    ? moderation.tasks(
        { school_id: campus.id.value, state: 'applied', limit: 5 },
        signal,
      )
    : Promise.resolve([]),
);

async function loadWork() {
  if (campus.status.value !== 'ready') await campus.load();
  await Promise.all([
    todos.reload(),
    campus.id.value ? recent.reload() : Promise.resolve(),
  ]);
}

async function retryTodos() {
  if (campus.status.value !== 'ready') await campus.load();
  await Promise.all([
    todos.reload(),
    campus.id.value ? recent.reload() : Promise.resolve(),
  ]);
}

watch(campus.id, (id, prev) => {
  if (!id) {
    recent.clear();
    return;
  }
  if (prev !== undefined && id !== prev) {
    void todos.reload();
    void recent.reload();
  }
});

onMounted(() => {
  void modules.reload();
  void loadWork();
});

const message = computed(() => {
  if (modules.status.value === 'ready') return t('page.framework.ready');
  if (modules.status.value === 'error') {
    const code = modules.error.value;
    return te(`page.framework.errors.${code}`)
      ? t(`page.framework.errors.${code}`)
      : t('page.framework.errors.network');
  }
  return t('page.framework.loading');
});
const display = (count: number) =>
  count >= countLimit
    ? `${format.value.number(countLimit - 1)}+`
    : format.value.number(count);
const label = (key: string) =>
  te(key) ? t(key) : (key.split('.').at(-1) ?? '');
const columns = computed(() => [
  { dataIndex: 'id', key: 'id', title: t('page.overview.module') },
  { key: 'state', title: t('page.overview.lifecycle') },
  { key: 'health', title: t('page.overview.health') },
]);
const stateColor: Record<string, string> = {
  ready: 'green',
  starting: 'blue',
  stopping: 'orange',
  stopped: 'default',
  disabled: 'default',
  failed: 'red',
};
</script>

<template>
  <AdminPage :title="t('page.framework.title')">
    <div class="flex flex-col gap-3">
      <Alert
        v-if="todos.data.value?.failed"
        type="warning"
        show-icon
        :message="t('page.overview.todoFailed')"
      >
        <template #action>
          <Button size="small" @click="retryTodos">
            {{ t('page.overview.todoRetry') }}
          </Button>
        </template>
      </Alert>

      <section
        :aria-label="t('page.overview.todoTitle')"
        class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        <RouterLink
          v-for="item in todos.data.value?.items"
          :key="item.key"
          :to="item.to"
          class="block"
        >
          <Card hoverable :bordered="false" class="h-full">
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted-foreground text-sm">{{
                t(`page.overview.todo.${item.key}`)
              }}</span>
              <component
                :is="item.icon"
                class="text-muted-foreground size-4 shrink-0"
                aria-hidden="true"
              />
            </div>
            <p
              class="mt-1 text-2xl font-semibold"
              :class="{ 'text-destructive': item.key === 'failed' && item.count }"
            >
              {{
                item.count === undefined
                  ? t('page.overview.todoUnknown')
                  : display(item.count)
              }}
            </p>
          </Card>
        </RouterLink>
      </section>

      <Card
        v-if="recent.data.value?.length"
        :bordered="false"
        :title="t('page.overview.recentTitle')"
      >
        <ul class="flex flex-col gap-2 text-sm">
          <li
            v-for="row in recent.data.value"
            :key="row.id"
            class="flex flex-wrap items-center justify-between gap-2"
          >
            <span>{{ label(`page.moderation.taskKind.${row.submission.kind}`) }}</span>
            <span class="text-muted-foreground">{{
              format.dateTime(row.updated_at)
            }}</span>
          </li>
        </ul>
      </Card>

      <Card :bordered="false" :title="t('page.framework.status')">
        <template #extra>
          <Button
            v-if="modules.data.value"
            size="small"
            :aria-expanded="showStatus"
            @click="showStatus = !showStatus"
          >
            {{
              t(
                showStatus
                  ? 'page.overview.hideModules'
                  : 'page.overview.showModules',
              )
            }}
          </Button>
        </template>
        <div role="status" aria-live="polite">
          <Alert
            :message="message"
            :type="
              modules.status.value === 'ready'
                ? 'success'
                : modules.status.value === 'error'
                  ? 'warning'
                  : 'info'
            "
            show-icon
          />
        </div>
        <Button
          v-if="modules.status.value === 'error'"
          class="mt-3"
          size="small"
          @click="modules.reload"
        >
          {{ t('page.framework.retry') }}
        </Button>
        <Table
          v-if="modules.data.value && showStatus"
          class="mt-3"
          :columns="columns"
          :data-source="modules.data.value"
          :pagination="false"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'state'">
              <Tag :color="stateColor[record.state]">
                {{ t(`page.overview.states.${record.state}`) }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'health'">
              {{
                record.health ? t(`page.overview.healthStates.${record.health}`) : ''
              }}
            </template>
          </template>
        </Table>
      </Card>
    </div>
  </AdminPage>
</template>
