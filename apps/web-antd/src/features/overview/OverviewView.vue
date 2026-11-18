<script setup lang="ts">
import type { Component } from 'vue';

import type { components as ModerationSchemas } from '#/api/moderation.gen';

import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Table, Tag } from 'ant-design-vue';
import {
  BadgeCheck,
  CircleAlert,
  Coins,
  FileCheck,
  GraduationCap,
  HardDrive,
  KeyRound,
  Mail,
  MessageSquare,
} from 'lucide-vue-next';

import { ApiError } from '#/shared/api/errors';
import { schemaOf } from '#/shared/api/schema';
import { useHostFetch } from '#/shared/api/transport';
import { useCapabilities } from '#/shared/capabilities';
import { useAsync } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import { useHttp, useSession } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';

import moderationContract from '../../../../../contracts/moderation.openapi.json';
import { useAcademicAdmin } from '../academic/api';
import { useCampus } from '../academic/campus';
import { BillingAdmin } from '../billing/api';
import { OpenPlatformAdmin } from '../open-platform/api';
import { storageAPI, StorageError } from '../storage/api';
import { VerificationApi } from '../verification/api';
import { getModules } from './api';

// Work first, system health second. Each count is fetched with the administrator's
// own permissions: a refused count hides its card, a failed one offers a retry.
const parseFeedbackPage = schemaOf<ModerationSchemas['schemas']['FeedbackPage']>(
  moderationContract.components.schemas,
  'FeedbackPage',
);

const { t, te } = useI18n();
const format = useFormat();
const http = useHttp();
const session = useSession();
const fetcher = useHostFetch();
const capabilities = useCapabilities();
const moderation = useAcademicAdmin();
const verification = new VerificationApi(http);
const billing = new BillingAdmin(http);
const openPlatform = new OpenPlatformAdmin(http);
const campus = useCampus();
const school = computed(() => campus.id.value);
const modules = useAsync((signal) => getModules(http, signal));
const countLimit = 100;
const maxScanPages = 5;
const showStatus = ref(false);

interface Todo {
  count: number | undefined;
  icon: Component;
  key: string;
  to: string;
}
const countOf = (rows: unknown[]) => rows.length;
const refused = (reason: unknown) =>
  (reason instanceof ApiError &&
    (reason.denied || reason.status === 401 || reason.status === 403)) ||
  (reason instanceof StorageError &&
    (reason.code === 'forbidden' || reason.code === 'unauthenticated'));

// Stop at the display threshold. A partial scan below it cannot give an exact count.
async function countPages(load: (after: string) => Promise<{ count: number; next?: string }>) {
  let count = 0;
  let after = '';
  const seen = new Set<string>();
  for (let page = 0; page < maxScanPages; page++) {
    const result = await load(after);
    count += result.count;
    if (!result.next || count >= countLimit) return count;
    if (seen.has(result.next)) return undefined;
    seen.add(result.next);
    after = result.next;
  }
  return undefined;
}

function countPendingVerifications(path: string, signal: AbortSignal) {
  return countPages(async (after) => {
    const result = await verification.list('Application', path, {
      after: after || undefined, limit: countLimit, signal,
    });
    return { count: result.items.filter((row) => row.state === 'pending_review').length, next: result.next };
  });
}

function countRefundState(state: string, signal: AbortSignal) {
  return countPages(async (after) => {
    const result = await billing.refunds(state, after, signal);
    return { count: result.items.length, next: result.next };
  });
}

function countPendingApps(signal: AbortSignal) {
  return countPages(async (after) => {
    const result = await openPlatform.apps(after, signal);
    return { count: result.items.filter((app) => app.state === 'pending').length, next: result.next };
  });
}

const todos = useAsync(async (signal) => {
  const id = school.value;
  const tasks = (state: string, kind?: string) =>
    moderation.tasks({ school_id: id, state, content_kind: kind, limit: countLimit }, signal);
  type Source = { icon: Component; key: string; load: () => Promise<number | undefined>; to: string };
  const sources: Source[] = [];
  const schoolSources: Source[] = [
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
      load: () =>
        countPendingVerifications(
          `/api/v1/admin/verification/schools/${encodeURIComponent(id)}/applications`,
          signal,
        ),
    },
    {
      key: 'teacherVerification',
      to: '/verification/teachers',
      icon: GraduationCap,
      load: () =>
        countPendingVerifications(
          `/api/v1/admin/verification/schools/${encodeURIComponent(id)}/teacher-applications`,
          signal,
        ),
    },
  ];
  sources.push({
    key: 'feedback',
    to: '/moderation/feedback',
    icon: Mail,
    load: () => countPages(async (after) => {
      const page = await http.json('/api/v1/moderation/feedback', parseFeedbackPage, {
        query: { after: after || undefined, state: 'new', limit: 50 }, signal,
      });
      return { count: page.items.length, next: page.next_cursor };
    }),
  });
  if (id) sources.unshift(...schoolSources);
  if (capabilities.has('billing.manage')) {
    sources.push({
      key: 'refunds',
      to: '/billing/refunds',
      icon: Coins,
      load: async () => {
        const counts = await Promise.all(['submitted', 'awaiting_manual', 'needs_review']
          .map((state) => countRefundState(state, signal)));
        const known = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
        return known >= countLimit || !counts.includes(undefined) ? known : undefined;
      },
    });
  }
  if (capabilities.has('open-platform.manage')) {
    sources.push({
      key: 'openPlatform',
      to: '/open-platform',
      icon: KeyRound,
      load: () => countPendingApps(signal),
    });
  }
  sources.push({
    key: 'storage',
    to: '/storage',
    icon: HardDrive,
    load: async () => {
      try {
        const value = await storageAPI(fetcher).read(signal);
        return value.jobs.blocked;
      } catch (error) {
        if (error instanceof StorageError && error.code === 'unauthenticated') session.invalidate();
        throw error;
      }
    },
  });

  const settled = await Promise.allSettled(sources.map((source) => source.load()));
  const items: Todo[] = [];
  let failed = false;
  if (!id && campus.status.value === 'error' && campus.failure.value !== 'forbidden' && campus.failure.value !== 'unauthenticated') {
    failed = true;
    for (const { key, to, icon } of schoolSources) items.push({ key, to, icon, count: undefined });
  }
  settled.forEach((result, index) => {
    const source = sources[index];
    if (!source) return;
    if (result.status === 'fulfilled') {
      items.push({ key: source.key, to: source.to, icon: source.icon, count: result.value });
    } else if (!refused(result.reason)) {
      failed = true;
      items.push({ key: source.key, to: source.to, icon: source.icon, count: undefined });
    }
  });
  return { items, failed };
});
const recent = useAsync((signal) =>
  moderation.tasks({ school_id: school.value, state: 'applied', limit: 5 }, signal),
);

watch(
  [() => campus.status.value, () => capabilities.status.value, school],
  ([campusStatus, capStatus]) => {
    if (
      capStatus === 'loading' ||
      campusStatus === 'idle' ||
      campusStatus === 'loading'
    ) {
      return;
    }
    void todos.reload();
    if (school.value) void recent.reload();
    else recent.clear();
  },
  { immediate: true },
);
async function retryTodos() {
  await (campus.status.value === 'ready' ? todos.reload() : campus.load());
}

onMounted(() => {
  if (campus.status.value !== 'ready') void campus.load();
  void modules.reload();
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
  count >= countLimit ? `${format.value.number(countLimit - 1)}+` : format.value.number(count);
const label = (key: string) => (te(key) ? t(key) : (key.split('.').at(-1) ?? ''));
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
      <Alert v-if="todos.data.value?.failed" type="warning" show-icon :message="t('page.overview.todoFailed')">
        <template #action>
          <Button size="small" @click="retryTodos">{{ t('page.overview.todoRetry') }}</Button>
        </template>
      </Alert>

      <section :aria-label="t('page.overview.todoTitle')" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <RouterLink v-for="item in todos.data.value?.items" :key="item.key" :to="item.to" class="block">
          <Card hoverable :bordered="false" class="h-full">
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted-foreground text-sm">{{ t(`page.overview.todo.${item.key}`) }}</span>
              <component :is="item.icon" class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            </div>
            <p class="mt-1 text-2xl font-semibold" :class="{ 'text-destructive': item.key === 'failed' && item.count }">
              {{ item.count === undefined ? t('page.overview.todoUnknown') : display(item.count) }}
            </p>
          </Card>
        </RouterLink>
      </section>

      <Card v-if="recent.data.value?.length" :bordered="false" :title="t('page.overview.recentTitle')">
        <ul class="flex flex-col gap-2 text-sm">
          <li v-for="row in recent.data.value" :key="row.id" class="flex flex-wrap items-center justify-between gap-2">
            <span>{{ label(`page.moderation.taskKind.${row.submission.kind}`) }}</span>
            <span class="text-muted-foreground">{{ format.dateTime(row.updated_at) }}</span>
          </li>
        </ul>
      </Card>

      <Card :bordered="false" :title="t('page.framework.status')">
        <template #extra>
          <Button v-if="modules.data.value" size="small" :aria-expanded="showStatus" @click="showStatus = !showStatus">{{ t(showStatus ? 'page.overview.hideModules' : 'page.overview.showModules') }}</Button>
        </template>
        <div role="status" aria-live="polite">
          <Alert :message="message" :type="modules.status.value === 'ready' ? 'success' : modules.status.value === 'error' ? 'warning' : 'info'" show-icon />
        </div>
        <Button v-if="modules.status.value === 'error'" class="mt-3" size="small" @click="modules.reload">{{ t('page.framework.retry') }}</Button>
        <Table v-if="modules.data.value && showStatus" class="mt-3" :columns="columns" :data-source="modules.data.value" :pagination="false" row-key="id" size="small">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'state'"><Tag :color="stateColor[record.state]">{{ t(`page.overview.states.${record.state}`) }}</Tag></template>
            <template v-else-if="column.key === 'health'">{{ record.health ? t(`page.overview.healthStates.${record.health}`) : '' }}</template>
          </template>
        </Table>
      </Card>
    </div>
  </AdminPage>
</template>
