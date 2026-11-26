<script setup lang="ts">
import type {
  Application,
  Credential,
  Job,
  RemovalRequest,
  Schemas,
  School,
  StudentProfile,
  Suggestion,
} from './api';

import {
  computed,
  getCurrentInstance,
  inject,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  DatePicker,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Form,
  FormItem,
  Input,
  InputNumber,
  Result,
  Select,
  Space,
  Switch,
  Table,
  TabPane,
  Tabs,
  Tag,
  Textarea,
} from 'ant-design-vue';

import { ApiError, errorCode, isDeniedCode } from '#/shared/api/errors';
import { useAsync, useMutation, usePaged, useTask } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import { sessionKey } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import MaterialPreview from '#/shared/ui/MaterialPreview.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';
import ReasonPresets from '#/shared/ui/ReasonPresets.vue';
import { stateColor } from '#/shared/ui/state-color';
import { safeExternalUrl } from '#/shared/url';

import { methods, schoolDataSchoolId, useVerification } from './api';
import CancelPendingRechecks from './CancelPendingRechecks.vue';
import SchoolDataAuthorization from './SchoolDataAuthorization.vue';
import SchoolSelect from './SchoolSelect.vue';

/**
 * Student verification administration per school: manual material review,
 * revocation and deletion requests, credential management, school
 * configuration, background jobs and school suggestions. Every request is
 * authorized by the server; full identity fields need their own permission.
 */
type Tab =
  | 'configuration'
  | 'credentials'
  | 'jobs'
  | 'requests'
  | 'reviews'
  | 'suggestions';

interface PreviewItem {
  id: string;
  objectUrl?: string;
  size?: number;
  tooLarge?: boolean;
  type: string;
  url?: string;
}

const inlinePreviewLimit = 15 * 1024 * 1024;
const applicationStates: Application['state'][] = ['pending_review', 'supplement_required', 'approved', 'rejected', 'in_progress', 'expired', 'deleted'];
const presetKeys = ['blurry', 'unregistered', 'mismatch', 'wrongType'] as const;

const { t, te } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useVerification();
const session = getCurrentInstance()
  ? inject(sessionKey, undefined)
  : undefined;
const write = useMutation();

const access = ref<'allowed' | 'checking' | 'denied' | 'error'>('checking');
const accessError = ref('');
const schools = ref<School[]>([]);
const schoolId = ref('');
const tab = ref<Tab>('reviews');
const stateFilter = ref<'' | Application['state']>('');
const autoNext = ref(true);
const readTask = useTask({ onDenied: clearSensitive });
const profileRead = useTask({
  onDenied: (cause) => {
    if (cause.status === 403 && cause.code !== 'unauthenticated') studentProfile.value = undefined;
    else clearSensitive();
  },
});
const busy = computed(() => readTask.busy.value || profileRead.busy.value);
const error = ref('');
const notice = ref('');
const applications = usePaged<Application>(
  (after, signal) =>
    schoolId.value
      ? api.list('Application', `/api/v1/admin/verification/schools/${encodeURIComponent(schoolId.value)}/applications`, { after, signal })
      : Promise.resolve({ items: [], next: '' }),
  { onDenied: deniedList },
);
const removals = usePaged<RemovalRequest>(
  (after, signal) =>
    schoolId.value
      ? api.list('RemovalRequest', `/api/v1/admin/verification/schools/${encodeURIComponent(schoolId.value)}/requests`, { after, signal })
      : Promise.resolve({ items: [], next: '' }),
  { onDenied: deniedList },
);
const jobs = usePaged<Job>(
  (after, signal) =>
    schoolId.value
      ? api.list('Job', `/api/v1/admin/verification/jobs?school_id=${encodeURIComponent(schoolId.value)}`, { after, signal })
      : Promise.resolve({ items: [], next: '' }),
  { onDenied: deniedList },
);
const suggestions = usePaged<Suggestion>(
  (after, signal) => api.list('Suggestion', '/api/v1/admin/verification/suggestions', { after, signal }),
  { onDenied: deniedList },
);
const schoolConfig = useAsync(async (signal) => {
  const school = schoolId.value;
  try {
    return await api.get('School', `/api/v1/admin/verification/schools/${encodeURIComponent(school)}`, signal);
  } catch (error_) {
    if (errorCode(error_) === 'not_found') return blankSchool(school);
    throw error_;
  }
}, { onDenied: deniedList });
const currentPaged = computed(() => {
  if (tab.value === 'reviews') return applications;
  if (tab.value === 'requests') return removals;
  if (tab.value === 'jobs') return jobs;
  if (tab.value === 'suggestions') return suggestions;
  return undefined;
});
const reviewing = shallowRef<Application>();
const manual = shallowRef<Schemas['ManualInput']>();
const pictures = ref<PreviewItem[]>([]);
const note = ref('');
const expiry = ref<string>();
const credentialId = ref('');
const credential = shallowRef<Credential>();
const studentProfile = shallowRef<StudentProfile>();
const notes = reactive<Record<string, string>>({});
const blankSchool = (id: string): School => ({
  id,
  name: '',
  enabled: false,
  methods: [],
  notice_version: 'v1',
  opening_date: '',
  newcomer_days: 90,
  school_data_recheck_days: 0,
  email_domain: '',
  material_types: ['student_card', 'admission_letter'],
  revision: 0,
});
const config = reactive<School>(blankSchool(''));
const materialTypes = ref('');
const teacherMaterials = ref('');

let pendingApply: ((result: unknown) => Promise<void> | void) | undefined;

const activeError = computed(() => error.value || (tab.value === 'configuration' ? schoolConfig.error.value : currentPaged.value?.error.value));
const locked = computed(
  () => busy.value || schoolConfig.status.value === 'loading' || currentPaged.value?.status.value === 'loading' || write.busy.value || write.uncertain.value,
);
const dirty = computed(
  () =>
    (!!reviewing.value && (!!note.value.trim() || !!expiry.value)) ||
    Object.values(notes).some((value) => !!value.trim()),
);
useLeaveGuard(() => {
  if (write.uncertain.value) return t('page.common.leaveUncertain');
  return dirty.value || locked.value ? t('page.common.leaveUnsaved') : '';
});

function label(key: string) {
  return te(key) ? t(key) : (key.split('.').at(-1) ?? '');
}

const visibleApplications = computed(() =>
  stateFilter.value ? applications.items.value.filter((item) => item.state === stateFilter.value) : applications.items.value,
);
const studentPresets = computed(() =>
  presetKeys.map((key) => ({ key, text: t(`page.verification.presets.${key}`) })),
);
const stateOptions = computed(() => [
  { value: '', label: t('page.common.all') },
  ...applicationStates.map((value) => ({ value, label: label(`page.verification.states.${value}`) })),
]);

function clearPictures() {
  for (const picture of pictures.value) {
    if (picture.objectUrl) URL.revokeObjectURL(picture.objectUrl);
  }
  pictures.value = [];
}

function deniedList(cause: ApiError) {
  clearSensitive();
  error.value = errorCode(cause);
}

function clearSensitive() {
  applications.clear();
  removals.clear();
  jobs.clear();
  suggestions.clear();
  schoolConfig.clear();
  note.value = '';
  notice.value = '';
  reviewing.value = undefined;
  manual.value = undefined;
  credential.value = undefined;
  studentProfile.value = undefined;
  clearPictures();
}

watch(
  () => session?.state.value,
  (state) => {
    if (state === 'guest') clearSensitive();
  },
);

async function readAction(
  work: () => Promise<void>,
  keepCredentialOn403 = false,
) {
  if (locked.value) return;
  error.value = '';
  notice.value = '';
  write.dismiss();
  const task = keepCredentialOn403 ? profileRead : readTask;
  await task.run(work);
  error.value = task.error.value;
}

async function runWrite<B, R>(
  signature: string,
  body: B,
  send: (frozen: B, key: string) => Promise<R>,
  apply: (result: R) => Promise<void> | void,
) {
  if (locked.value) return;
  error.value = '';
  notice.value = '';
  pendingApply = (result) => apply(result as R);
  const result = await write.run(signature, body, send);
  if (result !== undefined) {
    pendingApply = undefined;
    await apply(result);
    return;
  }
  if (!write.uncertain.value) {
    pendingApply = undefined;
    if (isDeniedCode(write.error.value)) {
      const deniedErr = write.error.value;
      clearSensitive();
      write.dismiss();
      error.value = deniedErr;
    }
  }
}

async function retryWrite() {
  const result = await write.retry();
  if (result !== undefined) {
    const apply = pendingApply;
    pendingApply = undefined;
    await apply?.(result);
    return;
  }
  if (!write.uncertain.value) {
    pendingApply = undefined;
    if (isDeniedCode(write.error.value)) {
      const deniedErr = write.error.value;
      clearSensitive();
      write.dismiss();
      error.value = deniedErr;
    }
  }
}

async function load(append = false) {
  if (write.uncertain.value || write.busy.value) return;
  error.value = '';
  notice.value = '';
  write.dismiss();
  if (!append) {
    reviewing.value = undefined;
    clearPictures();
  }
  if (tab.value === 'configuration') {
    await schoolConfig.reload();
    const current = schoolConfig.data.value;
    if (current && current.id === schoolId.value) {
      Object.assign(config, current);
      config.school_data_recheck_days = current.school_data_recheck_days ?? 0;
      materialTypes.value = current.material_types.join(', ');
      teacherMaterials.value = (current.teacher_material_types ?? []).join(', ');
    }
  } else {
    const page = currentPaged.value;
    await (append ? page?.loadMore() : page?.reload());
  }
}

async function loadReviewTarget(row: Application) {
  clearPictures();
  const id = encodeURIComponent(row.id);
  const form = await api.get('ManualInput', `/api/v1/admin/verification/applications/${id}/form`);
  const materials = await api.list('Material', `/api/v1/verification/applications/${id}/materials`);
  const items: PreviewItem[] = [];
  try {
    for (const material of materials.items) {
      if (material.size > inlinePreviewLimit) {
        items.push({ id: material.id, size: material.size, tooLarge: true, type: material.content_type });
        continue;
      }
      try {
        const blob = await api.material(material.id);
        if (blob.size > inlinePreviewLimit) {
          items.push({ id: material.id, size: blob.size, tooLarge: true, type: blob.type });
        } else {
          const objectUrl = URL.createObjectURL(blob);
          items.push({ id: material.id, objectUrl, size: blob.size, type: blob.type, url: objectUrl });
        }
      } catch (error_) {
        if (errorCode(error_) === 'capacity_exceeded') {
          items.push({ id: material.id, size: material.size, tooLarge: true, type: material.content_type });
        } else {
          throw error_;
        }
      }
    }
  } catch (error_) {
    for (const item of items) {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    }
    throw error_;
  }
  reviewing.value = row;
  manual.value = form;
  pictures.value = items;
  note.value = '';
  expiry.value = undefined;
}

async function downloadMaterial(id: string, size?: number) {
  const application = reviewing.value;
  if (application) await readAction(() => api.downloadMaterial(application.id, id, size));
}
function neighbour(step: number) {
  const rows = visibleApplications.value;
  const index = rows.findIndex((item) => item.id === reviewing.value?.id);
  return index === -1 ? undefined : rows[index + step];
}
async function moveReview(step: number) {
  const target = neighbour(step);
  if (!target || locked.value) return;
  if (note.value.trim() && !window.confirm(t('page.common.leaveUnsaved'))) return;
  await openReview(target);
}
async function openReview(row: Application) {
  await readAction(() => loadReviewTarget(row));
}
function closeReview() {
  if (locked.value || (dirty.value && !window.confirm(t('page.common.leaveUnsaved')))) return;
  write.dismiss();
  reviewing.value = undefined;
  clearPictures();
}

async function review(decision: Schemas['ReviewInput']['decision']) {
  const row = reviewing.value;
  if (!row) return;
  const following = neighbour(1);
  const body: Schemas['ReviewInput'] = {
    decision,
    note: note.value,
    revision: row.revision,
    ...(decision === 'approve' && expiry.value
      ? { expires_at: expiry.value }
      : {}),
  };
  await runWrite(
    `review:${row.id}:${row.revision}`,
    body,
    (frozen, key) =>
      api.write(
        'Application',
        `/api/v1/admin/verification/applications/${encodeURIComponent(row.id)}/review`,
        frozen,
        'POST',
        undefined,
        key,
      ),
    async () => {
      applications.items.value = applications.items.value.filter(
        (item) => item.id !== row.id,
      );
      reviewing.value = undefined;
      clearPictures();
      notice.value = t('page.common.saved');
      note.value = '';
      if (!autoNext.value) return;
      await readTask.run(async () => {
        let next = following;
        if (!next && applications.next.value) {
          await applications.loadMore();
          if (applications.status.value !== 'ready') return;
          next = visibleApplications.value.find((item) => item.id !== row.id && item.state === 'pending_review')
            ?? visibleApplications.value.find((item) => item.id !== row.id);
        }
        if (next) await loadReviewTarget(next);
      });
      if (readTask.error.value) error.value = readTask.error.value;
    },
  );
}

async function decideRemoval(row: RemovalRequest, approve: boolean) {
  const body: Schemas['DecisionInput'] = {
    approve,
    note: notes[row.id] ?? '',
    revision: row.revision,
  };
  await runWrite(
    `removal:${row.id}:${row.revision}`,
    body,
    (frozen, key) =>
      api.write(
        'RemovalRequest',
        `/api/v1/admin/verification/requests/${encodeURIComponent(row.id)}/review`,
        frozen,
        'POST',
        undefined,
        key,
      ),
    () => {
      removals.items.value = removals.items.value.filter((item) => item.id !== row.id);
      notice.value = t('page.common.saved');
    },
  );
}

async function decideSuggestion(row: Suggestion, approve: boolean) {
  const body: Schemas['DecisionInput'] = {
    approve,
    note: notes[row.id] ?? '',
    revision: row.revision,
  };
  await runWrite(
    `suggestion:${row.id}:${row.revision}`,
    body,
    (frozen, key) =>
      api.write(
        'Suggestion',
        `/api/v1/admin/verification/suggestions/${encodeURIComponent(row.id)}/review`,
        frozen,
        'POST',
        undefined,
        key,
      ),
    (saved) => {
      suggestions.items.value = suggestions.items.value.map((item) =>
        item.id === saved.id ? saved : item,
      );
      notice.value = t('page.common.saved');
    },
  );
}

async function retryJob(job: Job) {
  await runWrite(
    `job:${job.id}:${job.attempts}`,
    null,
    (_frozen, key) =>
      api.write(
        'Job',
        `/api/v1/admin/verification/jobs/${encodeURIComponent(job.id)}/retry`,
        undefined,
        'POST',
        undefined,
        key,
      ),
    (updated) => {
      jobs.items.value = jobs.items.value.map((item) =>
        item.id === updated.id ? updated : item,
      );
      notice.value = t('page.common.saved');
    },
  );
}

async function saveConfig() {
  const body: School = {
    ...config,
    methods: [...config.methods],
    teacher_enabled: config.teacher_enabled === true,
    teacher_material_types: teacherMaterials.value.split(',').map(value => value.trim()).filter(Boolean),
    material_types: materialTypes.value
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
  await runWrite(
    `school:${config.id}:${config.revision}`,
    body,
    (frozen, key) =>
      api.write(
        'School',
        `/api/v1/admin/verification/schools/${encodeURIComponent(config.id)}`,
        frozen,
        'PUT',
        undefined,
        key,
      ),
    (saved) => {
      Object.assign(config, saved);
      config.school_data_recheck_days = saved.school_data_recheck_days ?? 0;
      materialTypes.value = saved.material_types.join(', ');
      teacherMaterials.value = (saved.teacher_material_types ?? []).join(', ');
      notice.value = t('page.common.saved');
    },
  );
}

async function lookupCredential() {
  await readAction(async () => {
    studentProfile.value = undefined;
    credential.value = undefined;
    note.value = '';
    credential.value = await api.get(
      'Credential',
      `/api/v1/admin/verification/credentials/${encodeURIComponent(credentialId.value.trim())}`,
    );
  });
}

async function manageCredential(kind: 'graduate' | 'revoke') {
  const current = credential.value;
  if (!current) return;
  const body: Schemas['DecisionInput'] = {
    approve: true,
    note: note.value,
    revision: current.revision,
  };
  await runWrite(
    `credential:${current.id}:${kind}:${current.revision}`,
    body,
    (frozen, key) =>
      api.write(
        'Credential',
        `/api/v1/admin/verification/credentials/${encodeURIComponent(current.id)}/${kind}`,
        frozen,
        'POST',
        undefined,
        key,
      ),
    (updated) => {
      credential.value = updated;
      notice.value = t('page.common.saved');
    },
  );
}

// School data rechecks use the stored school account, so each one asks before it starts.
// The server only schedules them; its worker rechecks two at a time.
async function scheduleSchoolDataRecheck(scope: 'all' | 'credential') {
  const current = credential.value;
  if (scope === 'credential' && !current) return;
  const message = scope === 'all' ? t('page.verification.schoolData.confirmAll') : t('page.verification.schoolData.confirmOne', { student: current?.student_display ?? '' });
  if (!window.confirm(message)) return;
  const body: Schemas['SchoolDataRecheckRequest'] = scope === 'credential' && current ? { credential_id: current.id } : {};
  await runWrite(
    `school-data-recheck:${scope}:${body.credential_id ?? ''}`,
    body,
    (frozen, key) => api.write('SchoolDataRecheckReceipt', '/api/v1/admin/verification/school-data/recheck', frozen, 'POST', undefined, key),
    (receipt) => {
      notice.value = t('page.verification.schoolData.scheduled', { count: receipt.scheduled });
    },
  );
}

// The provider authorizes cancellation against BUAA's school configuration.
const canCancelPending = computed(() => schoolId.value === schoolDataSchoolId
  && schoolConfig.status.value === 'ready'
  && schoolConfig.data.value?.id === schoolId.value
  && schoolConfig.data.value.revision > 0);

async function cancelPendingRechecks() {
  if (!canCancelPending.value) return;
  await runWrite(
    'school-data.recheck-cancel',
    {},
    (_, key) => api.write('SchoolDataRecheckReceipt', '/api/v1/admin/verification/school-data/recheck/cancel', undefined, 'POST', undefined, key),
    ({ scheduled }) => {
      notice.value = t('page.verification.cancelPending.result', { count: format.value.number(scheduled) });
    },
  );
}

// Full identity, document and raw fields each need their own permission on the server.
async function showProfile(mode: 'basic' | 'document' | 'full' | 'raw') {
  const current = credential.value;
  if (!current) return;
  await readAction(async () => {
    studentProfile.value = undefined;
    const full = mode === 'full' || mode === 'raw';
    const document = mode === 'document' || mode === 'raw';
    studentProfile.value = await api.get(
      'StudentProfile',
      `/api/v1/admin/verification/credentials/${encodeURIComponent(current.id)}/profile?full=${full}&document=${document}&raw=${mode === 'raw'}`,
    );
  }, true);
}

function profileValue(value: unknown, field: string) {
  if (value === null || value === undefined || value === '')
    return t('page.common.notProvided');
  if (
    field === 'identity_valid_until' &&
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value))
  ) {
    return format.value.dateTime(value);
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

watch(schoolId, () => {
  if (write.uncertain.value) return;
  applications.clear();
  removals.clear();
  jobs.clear();
  if (access.value === 'allowed' && schoolId.value) void load();
});
watch(tab, () => {
  if (write.uncertain.value) return;
  if (schoolId.value) void load();
});
watch(credentialId, () => {
  if (write.uncertain.value) return;
  credential.value = undefined;
  studentProfile.value = undefined;
});

async function init() {
  access.value = 'checking';
  accessError.value = '';
  try {
    await api.consoleAccess();
    access.value = 'allowed';
    const page = await api.list('School', '/api/v1/verification/schools', {
      limit: 100,
    });
    schools.value = page.items;
    schoolId.value = schools.value[0]?.id ?? '';
  } catch (error_) {
    accessError.value = errorCode(error_);
    access.value = isDeniedCode(accessError.value) ? 'denied' : 'error';
  }
}

onMounted(init);
onBeforeUnmount(clearPictures);

const applicationColumns = computed(() => [
  { key: 'method', title: t('page.verification.method') },
  { key: 'study', title: t('page.verification.study') },
  { key: 'state', title: t('page.common.status') },
  { key: 'updated', title: t('page.common.updatedAt') },
  { key: 'action', title: t('page.common.operation') },
]);
const jobColumns = computed(() => [
  { key: 'kind', title: t('page.verification.jobKind') },
  { key: 'state', title: t('page.common.status') },
  {
    dataIndex: 'attempts',
    key: 'attempts',
    title: t('page.verification.attempts'),
  },
  { key: 'code', title: t('page.verification.resultCode') },
  { key: 'action', title: t('page.common.operation') },
]);
// Ant Design Vue types table rows as Record<string, any>; each row comes from this page's typed data source.
function chooseSchool(school: School) {
  schools.value = [
    ...new Map([...schools.value, school].map((item) => [item.id, item])).values(),
  ];
  schoolId.value = school.id;
}
</script>

<template>
  <AdminPage
    :title="t('page.verification.title')"
    :description="t('page.verification.intro')"
  >
    <Card v-if="access === 'checking'" :bordered="false" :loading="true" />
    <Result
      v-else-if="access !== 'allowed'"
      :status="access === 'denied' ? '403' : 'warning'"
      :title="
        t(
          access === 'denied'
            ? 'page.verification.noAccess'
            : 'page.errors.unavailable',
        )
      "
      :sub-title="errorText(accessError)"
    >
      <template v-if="access === 'error'" #extra>
        <Button type="primary" @click="init">
          {{ t('page.common.retry') }}
        </Button>
      </template>
    </Result>
    <div v-else class="flex flex-col gap-4">
      <Card :bordered="false">
        <Form layout="inline">
          <FormItem
            :label="t('page.common.school')"
            html-for="verification-school"
          >
            <SchoolSelect
              input-id="verification-school"
              :model-value="schoolId"
              :schools="schools"
              class="w-64 max-w-full"
              :disabled="locked"
              @select="chooseSchool"
            />
          </FormItem>
        </Form>
      </Card>
      <MutationAlert
        v-if="!reviewing"
        :busy="write.busy.value"
        :error="write.error.value"
        :uncertain="write.uncertain.value"
        :success="notice"
        @retry="retryWrite"
      />
      <Alert
        v-if="activeError && !reviewing"
        type="error"
        show-icon
        role="alert"
        :message="errorText(activeError)"
      />
      <Card :bordered="false">
        <Tabs v-model:active-key="tab">
          <TabPane
            key="reviews"
            :tab="t('page.verification.tabs.reviews')"
            :disabled="locked"
          >
            <Form layout="inline" class="mb-4 flex flex-wrap gap-y-2">
              <FormItem :label="t('page.common.status')" html-for="verification-state-filter">
                <Select id="verification-state-filter" v-model:value="stateFilter" class="w-44 max-w-full" :disabled="locked" :options="stateOptions" />
              </FormItem>
              <FormItem>
                <Button :disabled="locked || !schoolId" @click="load()">{{ t('page.common.refresh') }}</Button>
              </FormItem>
            </Form>
            <Table
              :columns="applicationColumns"
              :data-source="visibleApplications"
              :pagination="false"
              row-key="id"
              size="middle"
              :loading="applications.status.value === 'loading' && !applications.appending.value"
              :scroll="{ x: 640 }"
              :locale="{ emptyText: t('page.verification.noApplications') }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'method'">
                  {{ label(`page.verification.methods.${record.method}`) }}
                </template>
                <template v-else-if="column.key === 'study'">
                  {{ label(`page.verification.stages.${record.stage}`) }} ·
                  {{ label(`page.verification.kinds.${record.kind}`) }}
                </template>
                <template v-else-if="column.key === 'state'">
                  <Tag :color="stateColor(record.state)">{{ label(`page.verification.states.${record.state}`) }}</Tag>
                </template>
                <template v-else-if="column.key === 'updated'">
                  {{ format.dateTime(record.updated_at) }}
                </template>
                <template v-else-if="column.key === 'action'">
                  <Button
                    type="link"
                    size="small"
                    :disabled="locked"
                    @click="openReview(record as Application)"
                  >
                    {{ t('page.verification.review') }}
                  </Button>
                </template>
              </template>
            </Table>
          </TabPane>
          <TabPane
            key="requests"
            :tab="t('page.verification.tabs.requests')"
            :disabled="locked"
          >
            <p
              v-if="removals.items.value.length === 0 && !busy"
              class="text-muted-foreground"
            >
              {{ t('page.verification.noRequests') }}
            </p>
            <Card
              v-for="row in removals.items.value"
              :key="row.id"
              size="small"
              class="mb-3"
              :title="label(`page.verification.removalKind.${row.kind}`)"
            >
              <p class="whitespace-pre-wrap">{{ row.reason }}</p>
              <p class="text-muted-foreground text-xs">
                {{ t('page.verification.credential') }}:
                <span class="font-mono">{{ row.credential_id }}</span> ·
                {{ format.dateTime(row.created_at) }}
              </p>
              <FormItem
                class="mb-2 mt-3"
                :label="t('page.verification.note')"
                :html-for="`verification-removal-note-${row.id}`"
              >
                <Textarea
                  :id="`verification-removal-note-${row.id}`"
                  v-model:value="notes[row.id]"
                  :rows="2"
                  :maxlength="500"
                  :disabled="locked"
                />
              </FormItem>
              <Space>
                <Button
                  type="primary"
                  :disabled="locked"
                  @click="decideRemoval(row, true)"
                >
                  {{ t('page.verification.approve') }}
                </Button>
                <Button
                  danger
                  :disabled="locked"
                  @click="decideRemoval(row, false)"
                >
                  {{ t('page.verification.reject') }}
                </Button>
              </Space>
            </Card>
          </TabPane>
          <TabPane
            key="credentials"
            :tab="t('page.verification.tabs.credentials')"
            :disabled="locked"
          >
            <Form layout="inline" class="mb-4" @submit.prevent="lookupCredential">
              <FormItem
                :label="t('page.verification.credentialId')"
                html-for="verificationview-field-3"
              >
                <Input
                  id="verificationview-field-3"
                  v-model:value="credentialId"
                  :maxlength="128"
                  :disabled="locked"
                  class="w-80 max-w-full"
                />
              </FormItem>
              <FormItem>
                <Button
                  html-type="submit"
                  :disabled="locked || !credentialId.trim()"
                >
                  {{ t('page.common.search') }}
                </Button>
              </FormItem>
            </Form>
            <template v-if="credential">
              <Descriptions
                :column="{ xs: 1, sm: 2 }"
                size="small"
                bordered
                class="mb-4"
              >
                <DescriptionsItem :label="t('page.verification.student')">
                  {{ credential.student_display }}
                </DescriptionsItem>
                <DescriptionsItem :label="t('page.common.status')">
                  <Tag :color="stateColor(credential.state)">{{ label(`page.verification.states.${credential.state}`) }}</Tag>
                </DescriptionsItem>
                <DescriptionsItem :label="t('page.verification.study')">
                  {{ label(`page.verification.stages.${credential.stage}`) }} ·
                  {{ label(`page.verification.kinds.${credential.kind}`) }}
                </DescriptionsItem>
                <DescriptionsItem :label="t('page.verification.method')">
                  {{ label(`page.verification.methods.${credential.method}`) }}
                </DescriptionsItem>
                <DescriptionsItem :label="t('page.verification.verifiedAt')">
                  {{ format.dateTime(credential.verified_at) }}
                </DescriptionsItem>
                <DescriptionsItem :label="t('page.verification.expiresAt')">
                  {{
                    credential.expires_at
                      ? format.dateTime(credential.expires_at)
                      : t('page.verification.permanent')
                  }}
                </DescriptionsItem>
              </Descriptions>
              <Space class="mb-4" wrap>
                <Button :disabled="locked" @click="showProfile('basic')">
                  {{ t('page.verification.profileBasic') }}
                </Button>
                <Button :disabled="locked" @click="showProfile('full')">
                  {{ t('page.verification.profileFull') }}
                </Button>
                <Button :disabled="locked" @click="showProfile('document')">
                  {{ t('page.verification.profileDocument') }}
                </Button>
                <Button :disabled="locked" @click="showProfile('raw')">
                  {{ t('page.verification.profileRaw') }}
                </Button>
              </Space>
              <Card
                v-if="studentProfile"
                size="small"
                class="mb-4"
                :title="t('page.verification.profileTitle')"
              >
                <p class="text-muted-foreground mb-2 text-sm">
                  {{
                    label(
                      `page.verification.profileStatus.${studentProfile.data_status}`,
                    )
                  }}
                  <template v-if="studentProfile.collected_at">
                    · {{ format.dateTime(studentProfile.collected_at) }}
                  </template>
                </p>
                <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
                  <DescriptionsItem
                    v-for="(value, field) in studentProfile.fields"
                    :key="field"
                    :label="label(`page.verification.profileFields.${String(field)}`)"
                  >
                    {{ profileValue(value, String(field)) }}
                    <span
                      v-if="studentProfile.field_sources[field]"
                      class="text-muted-foreground ms-1 text-xs"
                    >
                      ·
                      {{
                        label(
                          `page.verification.profileSources.${studentProfile.field_sources[field] ?? ''}`,
                        )
                      }}
                    </span>
                  </DescriptionsItem>
                </Descriptions>
                <pre
                  v-if="studentProfile.raw_data"
                  class="bg-muted mt-3 max-h-80 overflow-auto rounded p-3 text-xs"
                >{{ studentProfile.raw_data }}</pre>
              </Card>
              <SchoolDataAuthorization
                v-if="credential.school_id === schoolDataSchoolId"
                :credential-id="credential.id"
              />
              <FormItem
                :label="t('page.verification.note')"
                html-for="verificationview-field-4"
              >
                <Textarea
                  id="verificationview-field-4"
                  v-model:value="note"
                  :rows="2"
                  :maxlength="500"
                  :disabled="locked"
                />
              </FormItem>
              <Space wrap>
                <Button
                  v-if="credential.school_id === schoolDataSchoolId"
                  :disabled="locked || credential.state !== 'active'"
                  @click="scheduleSchoolDataRecheck('credential')"
                >
                  {{ t('page.verification.schoolData.recheckOne') }}
                </Button>
                <Button
                  :disabled="locked || credential.state !== 'active'"
                  @click="manageCredential('graduate')"
                >
                  {{ t('page.verification.graduate') }}
                </Button>
                <Button
                  danger
                  :disabled="
                    locked || credential.state !== 'active' || !note.trim()
                  "
                  @click="manageCredential('revoke')"
                >
                  {{ t('page.verification.revoke') }}
                </Button>
              </Space>
            </template>
          </TabPane>
          <TabPane
            key="configuration"
            :tab="t('page.verification.tabs.configuration')"
            :disabled="locked"
          >
            <Form layout="vertical" class="max-w-3xl" @submit.prevent="saveConfig">
              <div class="grid gap-4 md:grid-cols-2">
                <FormItem
                  :label="t('page.verification.schoolName')"
                  html-for="verificationview-field-5"
                >
                  <Input
                    id="verificationview-field-5"
                    v-model:value="config.name"
                    :maxlength="100"
                    :disabled="locked"
                  />
                </FormItem>
                <FormItem
                  :label="t('page.verification.enabled')"
                  html-for="verificationview-field-6"
                >
                  <Switch
                    id="verificationview-field-6"
                    v-model:checked="config.enabled"
                    :disabled="locked"
                  />
                </FormItem>
                <FormItem
                  :label="t('page.verification.noticeVersion')"
                  html-for="verificationview-field-7"
                >
                  <Input
                    id="verificationview-field-7"
                    v-model:value="config.notice_version"
                    :maxlength="64"
                    :disabled="locked"
                  />
                </FormItem>
                <FormItem
                  :label="t('page.verification.openingDate')"
                  :extra="t('page.verification.openingDateHint')"
                  html-for="verificationview-field-8"
                >
                  <DatePicker
                    id="verificationview-field-8"
                    v-model:value="config.opening_date"
                    value-format="YYYY-MM-DD"
                    :disabled="locked"
                  />
                </FormItem>
                <FormItem
                  :label="t('page.verification.newcomerDays')"
                  html-for="verificationview-field-9"
                >
                  <InputNumber
                    id="verificationview-field-9"
                    v-model:value="config.newcomer_days"
                    :min="0"
                    :max="366"
                    :precision="0"
                    :disabled="locked"
                  />
                </FormItem>
                <FormItem
                  :label="t('page.verification.emailDomain')"
                  html-for="verificationview-field-10"
                >
                  <Input
                    id="verificationview-field-10"
                    v-model:value="config.email_domain"
                    :maxlength="253"
                    :disabled="locked"
                  />
                </FormItem>
                <FormItem
                  v-if="config.id === schoolDataSchoolId"
                  :label="t('page.verification.schoolData.recheckDays')"
                  :extra="t('page.verification.schoolData.recheckDaysHint')"
                  html-for="verificationview-field-school-data"
                >
                  <Space wrap>
                    <InputNumber
                      id="verificationview-field-school-data"
                      v-model:value="config.school_data_recheck_days"
                      :min="0"
                      :max="365"
                      :precision="0"
                      :disabled="locked"
                    />
                    <Button :disabled="locked" @click="scheduleSchoolDataRecheck('all')">
                      {{ t('page.verification.schoolData.recheckAll') }}
                    </Button>
                  </Space>
                </FormItem>
                <CancelPendingRechecks
                  v-if="canCancelPending"
                  :disabled="locked"
                  @confirm="cancelPendingRechecks"
                />
              </div>
              <FormItem :label="t('page.verification.methodsLabel')">
                <CheckboxGroup v-model:value="config.methods" :disabled="locked">
                  <Checkbox
                    v-for="method in methods"
                    :key="method"
                    :value="method"
                  >
                    {{ label(`page.verification.methods.${method}`) }}
                  </Checkbox>
                </CheckboxGroup>
              </FormItem>
              <FormItem :label="t('page.verification.teacherEnabled')">
                <Switch v-model:checked="config.teacher_enabled" :disabled="locked" :aria-label="t('page.verification.teacherEnabled')" />
              </FormItem>
              <FormItem :label="t('page.verification.teacherMaterials')" html-for="teacher-material-types">
                <Input id="teacher-material-types" v-model:value="teacherMaterials" :disabled="locked" />
              </FormItem>
              <FormItem
                :label="t('page.verification.materialTypesLabel')"
                :extra="t('page.verification.materialTypesHint')"
                html-for="verificationview-field-11"
              >
                <Input
                  id="verificationview-field-11"
                  v-model:value="materialTypes"
                  :disabled="locked"
                />
              </FormItem>
              <p class="text-muted-foreground mb-3 text-sm">
                {{
                  t('page.common.revisionValue', {
                    value: format.number(config.revision),
                  })
                }}
              </p>
              <Button
                type="primary"
                html-type="submit"
                :loading="write.busy.value"
                :disabled="locked || !config.id"
              >
                {{ t('page.common.save') }}
              </Button>
            </Form>
          </TabPane>
          <TabPane
            key="jobs"
            :tab="t('page.verification.tabs.jobs')"
            :disabled="locked"
          >
            <Table
              :columns="jobColumns"
              :data-source="jobs.items.value"
              :pagination="false"
              row-key="id"
              size="middle"
              :loading="jobs.status.value === 'loading' && !jobs.appending.value"
              :scroll="{ x: 560 }"
              :locale="{ emptyText: t('page.common.empty') }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'kind'">
                  {{ label(`page.verification.jobKinds.${record.kind}`) }}
                </template>
                <template v-else-if="column.key === 'state'">
                  <Tag :color="record.state === 'manual' ? 'red' : 'default'">
                    {{ label(`page.verification.jobStates.${record.state}`) }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'code'">
                  <span class="font-mono text-xs">{{ record.code }}</span>
                </template>
                <template v-else-if="column.key === 'action'">
                  <Button
                    v-if="record.state === 'manual'"
                    type="link"
                    size="small"
                    :disabled="locked"
                    @click="retryJob(record as Job)"
                  >
                    {{ t('page.verification.retryJob') }}
                  </Button>
                </template>
              </template>
            </Table>
          </TabPane>
          <TabPane
            key="suggestions"
            :tab="t('page.verification.tabs.suggestions')"
            :disabled="locked"
          >
            <p
              v-if="suggestions.items.value.length === 0 && !busy"
              class="text-muted-foreground"
            >
              {{ t('page.common.empty') }}
            </p>
            <Card
              v-for="row in suggestions.items.value"
              :key="row.id"
              size="small"
              class="mb-3"
              :title="row.name"
            >
              <a
                v-if="safeExternalUrl(row.website)"
                :href="safeExternalUrl(row.website)"
                target="_blank"
                rel="noopener noreferrer"
                class="break-all"
              >
                {{ row.website }}
              </a>
              <span v-else class="break-all">{{ row.website }}</span>
              <p class="mt-2">
                <Tag :color="stateColor(row.state)">{{ label(`page.verification.states.${row.state}`) }}</Tag>
                <span v-if="row.note" class="ms-2 text-sm">{{ row.note }}</span>
              </p>
              <template v-if="row.state === 'pending'">
                <FormItem
                  class="mb-2 mt-3"
                  :label="t('page.verification.note')"
                  :html-for="`verification-suggestion-note-${row.id}`"
                >
                  <Textarea
                    :id="`verification-suggestion-note-${row.id}`"
                    v-model:value="notes[row.id]"
                    :rows="2"
                    :maxlength="500"
                    :disabled="locked"
                  />
                </FormItem>
                <Space>
                  <Button
                    type="primary"
                    :disabled="locked"
                    @click="decideSuggestion(row, true)"
                  >
                    {{ t('page.verification.approve') }}
                  </Button>
                  <Button
                    danger
                    :disabled="locked"
                    @click="decideSuggestion(row, false)"
                  >
                    {{ t('page.verification.reject') }}
                  </Button>
                </Space>
              </template>
            </Card>
          </TabPane>
        </Tabs>
        <div class="mt-4 flex justify-center">
          <Button v-if="currentPaged?.next.value" :disabled="locked" @click="load(true)">
            {{ t('page.common.loadMore') }}
          </Button>
        </div>
      </Card>
    </div>

    <Drawer
      :open="!!reviewing"
      :width="760"
      :title="t('page.verification.reviewTitle')"
      :closable="!locked"
      :keyboard="!locked"
      :mask-closable="false"
      destroy-on-close
      @close="closeReview"
    >
      <div v-if="reviewing && manual" class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Checkbox v-model:checked="autoNext" :disabled="locked">{{ t('page.moderation.autoNext') }}</Checkbox>
          <Space>
            <Button size="small" :disabled="locked || !neighbour(-1)" @click="moveReview(-1)">{{ t('page.moderation.previous') }}</Button>
            <Button size="small" :disabled="locked || !neighbour(1)" @click="moveReview(1)">{{ t('page.moderation.next') }}</Button>
          </Space>
        </div>
        <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
          <DescriptionsItem :label="t('page.verification.studentId')">
            {{ manual.student_id }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.name')">
            {{ manual.name }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.department')">
            {{ manual.department || t('page.common.notProvided') }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.email')">
            {{ manual.email || t('page.common.notProvided') }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.materialType')">
            {{ label(`page.verification.materialTypes.${manual.material_type}`) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.study')">
            {{ label(`page.verification.stages.${reviewing.stage}`) }} ·
            {{ label(`page.verification.kinds.${reviewing.kind}`) }}
          </DescriptionsItem>
        </Descriptions>
        <div class="flex flex-col gap-3">
          <MaterialPreview
            v-for="(picture, index) in pictures"
            :key="picture.id"
            :content-type="picture.type"
            :label="t('page.verification.material', { index: index + 1 })"
            :size="picture.size"
            :too-large="picture.tooLarge"
            :url="picture.url"
          >
            <template #download>
              <Button :loading="busy" :disabled="locked" @click="downloadMaterial(picture.id, picture.size)">{{ t('page.resources.downloadFile') }}</Button>
            </template>
          </MaterialPreview>
        </div>
        <Form layout="vertical">
          <FormItem
            :label="t('page.verification.note')"
            html-for="verificationview-field-13"
          >
            <ReasonPresets v-model="note" :presets="studentPresets" :disabled="locked" :max-length="500" />
            <Textarea
              id="verificationview-field-13"
              v-model:value="note"
              :rows="3"
              :maxlength="500"
              :disabled="locked"
            />
          </FormItem>
          <FormItem
            v-if="reviewing.kind === 'newcomer'"
            :label="t('page.verification.expiryOverride')"
            :extra="t('page.verification.expiryOverrideHint')"
            html-for="verificationview-field-14"
          >
            <DatePicker
              id="verificationview-field-14"
              v-model:value="expiry"
              show-time
              value-format="YYYY-MM-DDTHH:mm:ssZ"
              :disabled="locked"
            />
          </FormItem>
        </Form>
        <Space wrap>
          <Button
            type="primary"
            :loading="write.busy.value"
            :disabled="locked"
            @click="review('approve')"
          >
            {{ t('page.verification.approve') }}
          </Button>
          <Button
            :disabled="locked || !note.trim()"
            @click="review('supplement')"
          >
            {{ t('page.verification.supplement') }}
          </Button>
          <Button
            danger
            :disabled="locked || !note.trim()"
            @click="review('reject')"
          >
            {{ t('page.verification.reject') }}
          </Button>
        </Space>
        <MutationAlert
          :busy="write.busy.value"
          :error="write.error.value"
          :uncertain="write.uncertain.value"
          @retry="retryWrite"
        />
        <Alert
          v-if="activeError"
          type="error"
          show-icon
          role="alert"
          :message="errorText(activeError)"
        />
      </div>
    </Drawer>
  </AdminPage>
</template>
