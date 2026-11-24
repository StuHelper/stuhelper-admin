<script setup lang="ts">
import type { Closure, ClosureBlocker, ClosureState } from './api';

import { computed, onMounted, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Form,
  FormItem,
  Select,
  Space,
  Table,
  Tag,
} from 'ant-design-vue';

import { ApiError, errorCode } from '#/shared/api/errors';
import { useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import { useSession } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import {
  canProcessClosure,
  closureBlockers,
  closureStates,
  closureSteps,
  useClosuresAdmin,
} from './api';

/**
 * Account closure administration. Applicants may cancel during the 7-day
 * cooling period; once that deadline passes, administrators inspect blocked
 * durable steps and resume processing idempotently.
 */
const props = withDefaults(defineProps<{ now?: () => number }>(), {
  now: () => Date.now(),
});

const { t, te } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const session = useSession();
const api = useClosuresAdmin();

const filter = ref<'all' | ClosureState>('all');
const blocker = ref<'all' | ClosureBlocker>('all');
const actionable = ref(false);
const closures = usePaged<Closure>((after, signal) => api.list(after, signal, {
  state: filter.value === 'all' ? undefined : filter.value,
  blocker: blocker.value === 'all' ? undefined : blocker.value,
  actionable: actionable.value || undefined,
}));
const rows = closures.items;
watch([filter, blocker, actionable], () => {
  clearDetail();
  void closures.reload();
});

const selected = shallowRef<Closure>();
const loadingDetail = ref(false);
const detailError = ref('');
const success = ref('');
const nowMs = ref(props.now());
const write = useMutation();
const locked = computed(
  () => loadingDetail.value || write.busy.value || write.uncertain.value,
);

useLeaveGuard(() => {
  if (write.uncertain.value) return t('page.common.leaveUncertain');
  if (write.busy.value) return t('page.common.leaveUnsaved');
  return '';
});

let accessVersion = 0;
function clearDetail() {
  accessVersion++;
  loadingDetail.value = false;
  selected.value = undefined;
  detailError.value = '';
  success.value = '';
}

function clearPrivate() {
  closures.clear();
  clearDetail();
}

function isDenied(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.denied || error.status === 401 || error.status === 403)
  );
}

watch(
  () => session.state.value,
  (state) => {
    if (state === 'guest') clearPrivate();
  },
);

watch(
  () => closures.error.value,
  (code) => {
    if (code === 'forbidden' || code === 'unauthenticated') {
      clearDetail();
    }
  },
);

onMounted(closures.reload);

async function open(row: Closure) {
  if (locked.value) return;
  nowMs.value = props.now();
  detailError.value = '';
  success.value = '';
  write.dismiss();
  selected.value = row;
  loadingDetail.value = true;
  const version = accessVersion;
  try {
    const fresh = await api.get(row.id);
    if (version !== accessVersion) return;
    nowMs.value = props.now();
    syncRow(fresh);
  } catch (error) {
    if (version !== accessVersion) return;
    if (isDenied(error)) {
      clearPrivate();
      await closures.reload();
      return;
    }
    detailError.value = errorCode(error);
  } finally {
    if (version === accessVersion) loadingDetail.value = false;
  }
}

function close() {
  if (locked.value) return;
  selected.value = undefined;
  detailError.value = '';
  success.value = '';
}

function syncRow(updated: Closure) {
  selected.value = updated;
  closures.items.value = closures.items.value.map((item) =>
    item.id === updated.id ? updated : item,
  );
}

const terminal = computed(
  () =>
    selected.value?.state === 'closed' || selected.value?.state === 'cancelled',
);
const coolingEnded = computed(() => {
  if (!selected.value) return false;
  const deadline = Date.parse(selected.value.cooling_ends_at);
  return Number.isFinite(deadline) && deadline <= nowMs.value;
});
const canResume = computed(
  () => !!selected.value && canProcessClosure(selected.value, nowMs.value),
);

async function resume() {
  const current = selected.value;
  if (!current || !canProcessClosure(current, props.now())) return;
  success.value = '';
  detailError.value = '';
  const version = accessVersion;
  const result = await write.run(
    `closure-process:${current.id}`,
    { closure_id: current.id },
    (_body, key) => api.process(current.id, key),
  );
  if (version !== accessVersion) return;
  if (result) settled(result);
  else if (
    write.error.value === 'forbidden' ||
    write.error.value === 'unauthenticated'
  ) {
    clearPrivate();
    await closures.reload();
  }
}

async function retryResume() {
  const version = accessVersion;
  const result = (await write.retry()) as Closure | undefined;
  if (version !== accessVersion) return;
  if (result) settled(result);
  else if (
    write.error.value === 'forbidden' ||
    write.error.value === 'unauthenticated'
  ) {
    clearPrivate();
    await closures.reload();
  }
}

function settled(updated: Closure) {
  nowMs.value = props.now();
  syncRow(updated);
  success.value = t(
    updated.state === 'closed'
      ? 'page.closures.completedNotice'
      : 'page.closures.resumedNotice',
  );
}

const stateColor: Record<ClosureState, string> = {
  cooling: 'blue',
  awaiting_assets: 'orange',
  processing: 'gold',
  closed: 'green',
  cancelled: 'default',
};

const label = (key: string, fallback: string) => (te(key) ? t(key) : fallback);

const columns = computed(() => [
  { key: 'profile', title: t('page.closures.profileId') },
  { key: 'state', title: t('page.common.status') },
  { key: 'blocker', title: t('page.closures.blocker') },
  { key: 'requested', title: t('page.closures.requestedAt') },
  { key: 'cooling', title: t('page.closures.coolingEndsAt') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage
    :title="t('page.closures.title')"
    :description="t('page.closures.intro')"
  >
    <div class="flex flex-col gap-4">
      <Card :bordered="false">
        <Form
          layout="inline"
          class="flex flex-wrap gap-y-3"
          @submit.prevent="closures.reload()"
        >
          <FormItem
            :label="t('page.common.status')"
            html-for="closures-state-filter"
          >
            <Select
              id="closures-state-filter"
              v-model:value="filter"
              class="w-48"
              :disabled="locked"
              :options="[
                { value: 'all', label: t('page.common.all') },
                ...closureStates.map((value) => ({
                  value,
                  label: t(`page.closures.states.${value}`),
                })),
              ]"
            />
          </FormItem>
          <FormItem :label="t('page.closures.blocker')" html-for="closures-blocker-filter">
            <Select
              id="closures-blocker-filter"
              v-model:value="blocker"
              class="w-48"
              :disabled="locked"
              :options="[
                { value: 'all', label: t('page.common.all') },
                ...closureBlockers.map(value => ({ value, label: t(`page.closures.blockers.${value}`) })),
              ]"
            />
          </FormItem>
          <FormItem>
            <Checkbox v-model:checked="actionable" :disabled="locked">{{ t('page.closures.actionable') }}</Checkbox>
          </FormItem>
          <FormItem>
            <Button
              :loading="closures.status.value === 'loading' && !closures.appending.value"
              :disabled="locked"
              @click="closures.reload()"
            >
              {{ t('page.common.refresh') }}
            </Button>
          </FormItem>
        </Form>
      </Card>

      <Card :bordered="false">
        <LoadState
          v-if="closures.status.value !== 'ready' || rows.length === 0"
          :status="closures.status.value === 'idle' ? 'loading' : closures.status.value"
          :error="closures.error.value"
          :empty="true"
          :empty-text="t('page.closures.empty')"
          @retry="closures.reload"
        />
        <Table
          v-else
          :columns="columns"
          :data-source="rows"
          :pagination="false"
          row-key="id"
          size="middle"
          :scroll="{ x: 760 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'profile'">
              <bdi class="font-mono break-all text-xs">{{ record.profile_id }}</bdi>
            </template>
            <template v-else-if="column.key === 'state'">
              <Tag :color="stateColor[record.state as ClosureState]">
                {{ t(`page.closures.states.${record.state}`) }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'blocker'">
              <Tag v-if="record.blocker" color="red">
                {{ label(`page.closures.blockers.${record.blocker}`, record.blocker) }}
              </Tag>
              <span v-else class="text-muted-foreground text-xs">{{
                t('page.closures.noBlocker')
              }}</span>
            </template>
            <template v-else-if="column.key === 'requested'">
              {{ format.dateTime(record.requested_at) }}
            </template>
            <template v-else-if="column.key === 'cooling'">
              {{ format.dateTime(record.cooling_ends_at) }}
            </template>
            <template v-else-if="column.key === 'action'">
              <Button
                type="link"
                size="small"
                :disabled="locked"
                @click="open(record as Closure)"
              >
                {{ t('page.common.open') }}
              </Button>
            </template>
          </template>
        </Table>
        <Alert
          v-if="closures.items.value.length > 0 && closures.error.value"
          class="mt-3"
          type="error"
          show-icon
          role="alert"
          :message="errorText(closures.error.value)"
        />
        <div v-if="closures.next.value" class="mt-4 flex justify-center">
          <Button
            :loading="closures.appending.value"
            :disabled="locked"
            @click="closures.loadMore"
          >
            {{ t('page.common.loadMore') }}
          </Button>
        </div>
      </Card>
    </div>

    <Drawer
      :open="!!selected"
      width="min(680px, 100vw)"
      :title="t('page.closures.detailTitle')"
      :mask-closable="false"
      :closable="!locked"
      :keyboard="!locked"
      destroy-on-close
      @close="close"
    >
      <div v-if="selected" class="flex flex-col gap-4">
        <Alert
          v-if="detailError"
          type="error"
          show-icon
          role="alert"
          :message="errorText(detailError)"
        />
        <Alert
          v-if="selected.blocker"
          type="warning"
          show-icon
          :message="label(`page.closures.blockers.${selected.blocker}`, selected.blocker)"
          :description="t('page.closures.blockerHint')"
        />

        <Descriptions :column="1" size="small" bordered>
          <DescriptionsItem :label="t('page.closures.closureId')">
            <bdi class="font-mono break-all text-xs">{{ selected.id }}</bdi>
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.closures.profileId')">
            <bdi class="font-mono break-all text-xs">{{ selected.profile_id }}</bdi>
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.common.status')">
            <Tag :color="stateColor[selected.state]">
              {{ t(`page.closures.states.${selected.state}`) }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.common.revision')">
            {{ format.number(selected.revision) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.closures.requestedAt')">
            {{ format.dateTime(selected.requested_at) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.closures.coolingEndsAt')">
            {{ format.dateTime(selected.cooling_ends_at) }}
          </DescriptionsItem>
          <DescriptionsItem
            v-if="selected.completed_at"
            :label="t('page.closures.completedAt')"
          >
            {{ format.dateTime(selected.completed_at) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.closures.completedSteps')">
            <Space wrap>
              <Tag
                v-for="step in closureSteps"
                :key="step"
                :color="selected.completed_steps.includes(step) ? 'green' : 'default'"
              >
                {{ t(`page.closures.steps.${step}`) }} ·
                {{
                  t(
                    selected.completed_steps.includes(step)
                      ? 'page.closures.stepDone'
                      : 'page.closures.stepPending',
                  )
                }}
              </Tag>
            </Space>
          </DescriptionsItem>
          <DescriptionsItem v-if="selected.pending_reasons?.length" :label="t('page.closures.blocker')">
            {{ format.list(selected.pending_reasons.map(reason => t(`page.closures.reasons.${reason}`))) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.closures.skippedModules')">
            <span v-if="selected.skipped_modules?.length">
              {{
                format.list(
                  selected.skipped_modules.map((mod) =>
                    label(`page.closures.modules.${mod}`, mod),
                  ),
                )
              }}
            </span>
            <span v-else class="text-muted-foreground">{{
              t('page.closures.noSkipped')
            }}</span>
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.closures.blocker')">
            <Tag v-if="selected.blocker" color="red">
              {{ label(`page.closures.blockers.${selected.blocker}`, selected.blocker) }}
            </Tag>
            <span v-else class="text-muted-foreground">{{
              t('page.closures.noBlocker')
            }}</span>
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.closures.pointsPolicy')">
            {{
              label(
                `page.closures.pointsPolicies.${selected.points_policy}`,
                selected.points_policy,
              )
            }}
          </DescriptionsItem>
        </Descriptions>

        <Alert
          v-if="!terminal && !coolingEnded"
          type="info"
          show-icon
          :message="
            t('page.closures.coolingHint', {
              time: format.dateTime(selected.cooling_ends_at),
            })
          "
        />

        <MutationAlert
          :busy="write.busy.value"
          :error="write.error.value"
          :uncertain="write.uncertain.value"
          :success="success"
          @retry="retryResume"
        />

        <Space v-if="!terminal" wrap>
          <Button
            type="primary"
            :loading="write.busy.value"
            :disabled="!canResume || loadingDetail || write.uncertain.value"
            @click="resume"
          >
            {{ t('page.closures.process') }}
          </Button>
          <Button
            :disabled="locked"
            @click="open(selected)"
          >
            {{ t('page.common.refresh') }}
          </Button>
        </Space>
      </div>
    </Drawer>
  </AdminPage>
</template>
