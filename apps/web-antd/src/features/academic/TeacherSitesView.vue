<script setup lang="ts">
import type { TeacherRefreshRun, UnmatchedTeacherSite } from './api';

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Popconfirm,
  Select,
  SelectOption,
  Space,
  Statistic,
  Table,
  Tag,
} from 'ant-design-vue';

import { ApiError, errorCode } from '#/shared/api/errors';
import { useAsync, useMutation } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useAcademicAdmin } from './api';
import { useCampusId } from './campus';
import CampusPending from './CampusPending.vue';

/**
 * Teacher homepage refresh for the selected school. The scheduled refresh runs
 * monthly and is incremental; a full refresh is started here by hand. The page
 * shows the latest run, the current teacher mark counts and the homepages that
 * could not be matched to exactly one catalog teacher. Staff numbers and
 * contact details are never part of these responses.
 */
const { t } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useAcademicAdmin();
const school = useCampusId();
const start = useMutation();

const status = useAsync((signal) =>
  school.value
    ? api.teacherRefresh(school.value, signal)
    : Promise.resolve(undefined),
);
// reload() clears data while a request is in flight; keep the last answer so the
// page does not flicker and a loading gap is not mistaken for a finished run.
const known = shallowRef<typeof status.data.value>();
watch(
  () => status.data.value,
  (value) => {
    if (value) known.value = value;
  },
);
watch(
  () => status.status.value,
  (value) => {
    if (value === 'error' && ['forbidden', 'unauthenticated'].includes(status.error.value)) known.value = undefined;
  },
);
const latest = computed(() => known.value?.latest ?? undefined);
const active = computed(
  () => latest.value?.status === 'queued' || latest.value?.status === 'running',
);

// While a run is queued or running, check again every five seconds.
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [active.value, known.value, status.status.value] as const,
  () => {
    clearTimeout(timer);
    const retryable = status.status.value === 'ready' ||
      status.status.value === 'error' && ['network', 'rate_limited', 'timeout', 'unavailable'].includes(status.error.value);
    if (active.value && retryable) timer = setTimeout(() => void status.reload(), 5000);
  },
);
onBeforeUnmount(() => clearTimeout(timer));

async function run(mode: 'full' | 'incremental') {
  if (!school.value) return;
  const target = school.value;
  const saved = await start.run(mode, { mode }, (body, key) =>
    api.startTeacherRefresh(target, body, key),
  );
  if (saved || start.error.value === 'conflict') void status.reload();
}
async function retry() {
  const saved = await start.retry();
  // The retried request is the original refresh request.
  if (saved) void status.reload();
}

// Unmatched homepages, filtered by reason and loaded page by page.
const reason = ref('');
const rows = shallowRef<UnmatchedTeacherSite[]>([]);
const next = ref('');
const reasonCounts = shallowRef<Record<string, number>>({});
const total = ref(0);
const observedAt = ref<null | string>(null);
const listError = ref('');
const loading = ref(false);
let generation = 0;
async function load(more = false) {
  if (!school.value) return;
  const current = ++generation;
  loading.value = true;
  listError.value = '';
  try {
    const page = await api.unmatchedTeacherSites(school.value, {
      reason: reason.value || undefined,
      limit: 50,
      after: more ? next.value : undefined,
    });
    if (current !== generation) return;
    rows.value = more ? [...rows.value, ...page.items] : page.items;
    next.value = page.next;
    total.value = page.total;
    observedAt.value = page.observed_at;
    reasonCounts.value = page.reason_counts as Record<string, number>;
  } catch (error_) {
    if (current !== generation) return;
    listError.value = errorCode(error_);
    // Without read permission the names and units already shown must go too.
    if (error_ instanceof ApiError && error_.denied) {
      rows.value = [];
      next.value = '';
      total.value = 0;
      observedAt.value = null;
      reasonCounts.value = {};
    }
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(
  school,
  () => {
    known.value = undefined;
    void status.reload();
    void load();
  },
  { immediate: true },
);
watch(reason, () => void load());
// When a run reaches a final state, the unmatched list may have changed, so read
// it again. Only received answers count; the loading gap between polls does not.
let seen: string | undefined;
watch(latest, (run) => {
  if (!run) return;
  const before = seen;
  seen = `${run.id}:${run.status}`;
  const finished = run.status !== 'queued' && run.status !== 'running';
  if (before && before !== seen && finished) void load();
});

const reasons = [
  'unit_mismatch',
  'ambiguous_catalog',
  'catalog_unit_missing',
  'site_unit_missing',
  'catalog_name_absent',
  'ambiguous_site',
] as const;
const statusColor: Record<TeacherRefreshRun['status'], string> = {
  queued: 'default',
  running: 'processing',
  succeeded: 'success',
  failed: 'error',
  timed_out: 'warning',
};
const columns = computed(() => [
  { dataIndex: 'name', key: 'name', title: t('page.teacherSites.name') },
  { dataIndex: 'unit', key: 'unit', title: t('page.teacherSites.unit') },
  { key: 'reason', title: t('page.teacherSites.reason') },
  {
    key: 'candidates',
    title: t('page.teacherSites.candidates'),
    align: 'right' as const,
  },
]);
const dash = '—';
</script>

<template>
  <AdminPage
    :title="t('page.teacherSites.title')"
    :description="t('page.teacherSites.intro')"
  >
    <CampusPending v-if="!school" @ready="school = $event" />
    <div class="flex flex-col gap-4">
      <Card :bordered="false" :title="t('page.teacherSites.marks')">
        <Alert
          v-if="status.status.value === 'error'"
          class="mb-4"
          type="error"
          show-icon
          role="alert"
          :message="errorText(status.error.value)"
        />
        <Button
          v-if="status.status.value === 'error'"
          class="mb-4"
          @click="status.reload()"
        >
          {{ t('page.common.retry') }}
        </Button>
        <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Statistic
            :title="t('page.teacherSites.eligible')"
            :value="known?.counts.eligible ?? dash"
          />
          <Statistic
            :title="t('page.teacherSites.teaching')"
            :value="known?.counts.teaching ?? dash"
          />
          <Statistic
            :title="t('page.teacherSites.official')"
            :value="known?.counts.official ?? dash"
          />
          <Statistic
            :title="t('page.teacherSites.both')"
            :value="known?.counts.both ?? dash"
          />
        </div>
      </Card>

      <Card :bordered="false" :title="t('page.teacherSites.latestRun')">
        <template #extra>
          <Space>
            <Button
              :disabled="!school || active || start.busy.value || start.uncertain.value"
              :loading="start.busy.value"
              @click="run('incremental')"
            >
              {{ t('page.teacherSites.runIncremental') }}
            </Button>
            <Popconfirm
              :title="t('page.teacherSites.fullConfirm')"
              :ok-text="t('page.teacherSites.runFull')"
              :cancel-text="t('page.common.cancel')"
              @confirm="run('full')"
            >
              <Button
                type="primary"
                :disabled="!school || active || start.busy.value || start.uncertain.value"
              >
                {{ t('page.teacherSites.runFull') }}
              </Button>
            </Popconfirm>
          </Space>
        </template>
        <MutationAlert
          class="mb-4"
          :busy="start.busy.value"
          :error="start.error.value === 'conflict' ? '' : start.error.value"
          :uncertain="start.uncertain.value"
          @retry="retry"
        />
        <Alert
          v-if="start.error.value === 'conflict'"
          class="mb-4"
          type="info"
          show-icon
          :message="t('page.teacherSites.alreadyRunning')"
        />
        <p class="mb-4 text-sm opacity-70">
          {{ t('page.teacherSites.schedule') }}
        </p>
        <Descriptions
          v-if="latest"
          size="small"
          bordered
          :column="{ xs: 1, sm: 2, lg: 3 }"
        >
          <DescriptionsItem :label="t('page.common.status')">
            <Tag :color="statusColor[latest.status]">
              {{ t(`page.teacherSites.status.${latest.status}`) }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherSites.mode')">
            {{ t(`page.teacherSites.modes.${latest.mode}`) }} ·
            {{ t(`page.teacherSites.triggers.${latest.trigger}`) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherSites.requestedAt')">
            {{ format.dateTime(latest.requested_at) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherSites.finishedAt')">
            {{ latest.finished_at ? format.dateTime(latest.finished_at) : dash }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherSites.duration')">
            {{
              latest.duration_ms
                ? t('page.teacherSites.seconds', {
                    value: format.number(Math.round(latest.duration_ms / 1000)),
                  })
                : dash
            }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherSites.requests')">
            {{ latest.requests === null ? dash : format.number(latest.requests) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherSites.sites')">
            {{ latest.site_count === null ? dash : format.number(latest.site_count) }}
          </DescriptionsItem>
          <DescriptionsItem
            v-if="latest.failure_reason"
            :label="t('page.teacherSites.failure')"
          >
            {{ t(`page.teacherSites.failures.${latest.failure_reason}`) }}
          </DescriptionsItem>
        </Descriptions>
        <p
          v-else-if="status.status.value === 'ready'"
          class="text-sm opacity-70"
        >
          {{ t('page.teacherSites.noRun') }}
        </p>
      </Card>

      <Card :bordered="false" :title="t('page.teacherSites.unmatched')">
        <template #extra>
          <Select
            v-model:value="reason"
            class="min-w-48"
            :aria-label="t('page.teacherSites.reason')"
          >
            <SelectOption value="">
              {{
                t('page.teacherSites.allReasons', {
                  count: format.number(
                    Object.values(reasonCounts).reduce((a, b) => a + b, 0),
                  ),
                })
              }}
            </SelectOption>
            <SelectOption v-for="item in reasons" :key="item" :value="item">
              {{
                t('page.teacherSites.reasonCount', {
                  reason: t(`page.teacherSites.reasons.${item}`),
                  count: format.number(reasonCounts[item] ?? 0),
                })
              }}
            </SelectOption>
          </Select>
        </template>
        <p v-if="observedAt" class="mb-4 text-sm opacity-70">
          {{
            t('page.teacherSites.observedAt', {
              time: format.dateTime(observedAt),
              count: format.number(total),
            })
          }}
        </p>
        <Alert
          v-if="listError"
          class="mb-4"
          type="error"
          show-icon
          role="alert"
          :message="errorText(listError)"
        />
        <Table
          :columns="columns"
          :data-source="rows"
          :loading="loading"
          :pagination="false"
          :row-key="(row: UnmatchedTeacherSite) => row.site_id"
          size="small"
          :scroll="{ x: 560 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'reason'">
              {{ t(`page.teacherSites.reasons.${record.reason}`) }}
            </template>
            <template v-else-if="column.key === 'candidates'">
              {{ format.number(record.candidate_count) }}
            </template>
          </template>
        </Table>
        <Button
          v-if="next"
          class="mt-4"
          :loading="loading"
          @click="load(true)"
        >
          {{ t('page.common.loadMore') }}
        </Button>
      </Card>
    </div>
  </AdminPage>
</template>
