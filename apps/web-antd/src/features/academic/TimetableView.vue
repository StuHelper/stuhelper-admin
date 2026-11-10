<script setup lang="ts">
import type { CatalogObject, Timetable } from './api';

import { computed, reactive, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Form, FormItem, Input, Select, Space, Table } from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useAcademicAdmin } from './api';
import { useCampusId } from './campus';
import CampusPending from './CampusPending.vue';

/**
 * Period times of one school term. Student timetables and calendar exports use
 * them to turn period numbers into clock times; a term without them cannot be
 * exported. Each save sends the revision it started from, so two administrators
 * never overwrite each other.
 */
const { t } = useI18n();
const api = useAcademicAdmin();
const school = useCampusId();
const terms = shallowRef<CatalogObject[]>([]);
const term = ref<string>();
const status = ref<'error' | 'idle' | 'loading' | 'ready'>('idle');
const loadError = ref('');
const saved = shallowRef<Timetable>();
const form = reactive({ week_one_start: '', timezone: 'Asia/Shanghai', periods: [] as { end: string; start: string }[] });
const save = useMutation();
const success = ref('');
const locked = computed(() => save.busy.value || save.uncertain.value);

watch(school, async (id) => {
  if (!id) return;
  try {
    terms.value = await api.options({ kind: 'term', school_id: id });
    term.value = terms.value.at(-1)?.id;
  } catch (error) {
    loadError.value = errorCode(error);
    status.value = 'error';
  }
}, { immediate: true });

function fill(value?: Timetable) {
  saved.value = value;
  form.week_one_start = value?.week_one_start ?? '';
  form.timezone = value?.timezone ?? 'Asia/Shanghai';
  form.periods = (value?.periods ?? []).map((period) => ({ start: period.start, end: period.end }));
}
async function load(keepDraft = false) {
  if (!school.value || !term.value) return;
  status.value = 'loading';
  loadError.value = '';
  try {
    const value = await api.timetable(school.value, term.value);
    if (keepDraft) saved.value = value;
    else fill(value);
    save.dismiss();
    status.value = 'ready';
  } catch (error) {
    loadError.value = errorCode(error);
    status.value = 'error';
  }
}
watch(term, () => {
  success.value = '';
  void load();
});

const draft = computed(() => JSON.stringify([form.week_one_start, form.timezone, form.periods]));
const original = computed(() => JSON.stringify([saved.value?.week_one_start ?? '', saved.value?.timezone ?? 'Asia/Shanghai', (saved.value?.periods ?? []).map((p) => ({ start: p.start, end: p.end }))]));
const dirty = computed(() => draft.value !== original.value);
useLeaveGuard(() => (save.uncertain.value ? t('page.common.leaveUncertain') : (dirty.value ? t('page.common.leaveUnsaved') : '')));

// Checks the server repeats; they let the form explain a mistake before sending.
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const problem = computed(() => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.week_one_start) || new Date(`${form.week_one_start}T00:00:00Z`).getUTCDay() !== 1) return 'notMonday';
  try {
    new Intl.DateTimeFormat('en', { timeZone: form.timezone });
  } catch {
    return 'timezone';
  }
  if (form.periods.length === 0) return 'noPeriods';
  let last = -1;
  for (const period of form.periods) {
    if (!clock.test(period.start) || !clock.test(period.end) || minutes(period.end) <= minutes(period.start)) return 'periodTime';
    if (minutes(period.start) < last) return 'periodOrder';
    last = minutes(period.end);
  }
  return '';
});

function addPeriod() {
  const previous = form.periods.at(-1);
  const start = previous ? Math.min(minutes(previous.end) + 10, 23 * 60) : 8 * 60;
  const text = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  form.periods.push({ start: text(start), end: text(Math.min(start + 45, 23 * 60 + 59)) });
}
function removePeriod(index: number) {
  form.periods.splice(index, 1);
}

async function submit() {
  if (!school.value || !term.value || problem.value || !dirty.value) return;
  success.value = '';
  const body: Timetable = {
    school_id: school.value,
    term_id: term.value,
    revision: saved.value?.revision ?? 0,
    week_one_start: form.week_one_start,
    timezone: form.timezone.trim(),
    periods: form.periods.map((period, index) => ({ number: index + 1, start: period.start, end: period.end })),
  };
  const result = await save.run(`timetable:${body.school_id}:${body.term_id}`, body, (value, key) => api.saveTimetable(value, key));
  if (result) done(result);
}
async function retry() {
  const result = (await save.retry()) as Timetable | undefined;
  if (result) done(result);
}
function done(result: Timetable) {
  fill(result);
  success.value = t('page.timetable.saved');
}

const columns = computed(() => [
  { key: 'number', title: t('page.timetable.period'), width: 80 },
  { key: 'start', title: t('page.timetable.start') },
  { key: 'end', title: t('page.timetable.end') },
  { key: 'actions', title: t('page.common.operation'), width: 100 },
]);
</script>

<template>
  <AdminPage :title="t('page.timetable.title')" :description="t('page.timetable.intro')">
    <CampusPending v-if="!school" @ready="school = $event" />
    <Card v-else :bordered="false">
      <FormItem :label="t('page.timetable.term')" html-for="timetable-term">
        <Select id="timetable-term" v-model:value="term" class="max-w-80" :disabled="locked || dirty" :options="terms.map((item) => ({ value: item.id, label: item.name }))" />
      </FormItem>
      <LoadState v-if="status !== 'ready'" :status="status === 'idle' ? 'loading' : status" :error="loadError" @retry="load()">
        <span></span>
      </LoadState>
      <Form v-else layout="vertical" @submit.prevent="submit">
        <Alert v-if="!saved" class="mb-4" type="info" show-icon :message="t('page.timetable.missing')" />
        <div class="grid gap-3 md:grid-cols-2">
          <FormItem :label="t('page.timetable.weekOne')" :extra="t('page.timetable.weekOneHint')" required html-for="timetable-week-one">
            <Input id="timetable-week-one" v-model:value="form.week_one_start" type="date" :disabled="locked" />
          </FormItem>
          <FormItem :label="t('page.timetable.timezone')" :extra="t('page.timetable.timezoneHint')" required html-for="timetable-timezone">
            <Input id="timetable-timezone" v-model:value="form.timezone" :maxlength="64" :disabled="locked" autocomplete="off" />
          </FormItem>
        </div>
        <Table :columns="columns" :data-source="form.periods" :pagination="false" :row-key="(_row: unknown, index?: number) => String(index)" size="small" :scroll="{ x: 480 }">
          <template #bodyCell="{ column, record, index }">
            <template v-if="column.key === 'number'">{{ index + 1 }}</template>
            <template v-else-if="column.key === 'start'">
              <Input v-model:value="record.start" type="time" :aria-label="t('page.timetable.startOf', { number: index + 1 })" :disabled="locked" />
            </template>
            <template v-else-if="column.key === 'end'">
              <Input v-model:value="record.end" type="time" :aria-label="t('page.timetable.endOf', { number: index + 1 })" :disabled="locked" />
            </template>
            <template v-else-if="column.key === 'actions'">
              <Button size="small" danger :disabled="locked" :aria-label="t('page.timetable.removeOf', { number: index + 1 })" @click="removePeriod(index)">{{ t('page.timetable.remove') }}</Button>
            </template>
          </template>
        </Table>
        <Button class="mt-3" :disabled="locked || form.periods.length >= 30" @click="addPeriod">{{ t('page.timetable.add') }}</Button>
        <Alert v-if="problem && dirty" class="mt-4" type="warning" show-icon :message="t(`page.timetable.problems.${problem}`)" />
        <MutationAlert class="mt-4" :busy="save.busy.value" :error="save.error.value" :uncertain="save.uncertain.value" :success="success" @retry="retry" />
        <Space class="mt-4" wrap>
          <Button type="primary" html-type="submit" :loading="save.busy.value" :disabled="save.uncertain.value || !dirty || !!problem">{{ t('page.common.save') }}</Button>
          <Button v-if="save.error.value === 'conflict'" :disabled="locked" @click="load(true)">{{ t('page.common.reloadCompare') }}</Button>
          <Button :disabled="locked || !dirty" @click="fill(saved)">{{ t('page.common.discard') }}</Button>
        </Space>
      </Form>
    </Card>
  </AdminPage>
</template>
