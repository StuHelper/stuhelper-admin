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
  Image,
  Input,
  InputNumber,
  Result,
  Space,
  Switch,
  Table,
  TabPane,
  Tabs,
  Tag,
  Textarea,
} from 'ant-design-vue';

import { ApiError, errorCode, isDeniedCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import { sessionKey } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';
import { safeExternalUrl } from '#/shared/url';

import { methods, useVerification } from './api';
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
const busy = ref(false);
const error = ref('');
const notice = ref('');
const applications = ref<Application[]>([]);
const removals = ref<RemovalRequest[]>([]);
const jobs = ref<Job[]>([]);
const suggestions = ref<Suggestion[]>([]);
const cursor = ref('');
const reviewing = shallowRef<Application>();
const manual = shallowRef<Schemas['ManualInput']>();
const pictures = ref<{ id: string; type: string; url: string }[]>([]);
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
  email_domain: '',
  material_types: ['student_card', 'admission_letter'],
  revision: 0,
});
const config = reactive<School>(blankSchool(''));
const materialTypes = ref('');

let pendingApply: ((result: unknown) => void) | undefined;

const locked = computed(
  () => busy.value || write.busy.value || write.uncertain.value,
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

function clearPictures() {
  for (const picture of pictures.value) URL.revokeObjectURL(picture.url);
  pictures.value = [];
}

function clearSensitive() {
  applications.value = [];
  removals.value = [];
  jobs.value = [];
  suggestions.value = [];
  cursor.value = '';
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
  busy.value = true;
  error.value = '';
  notice.value = '';
  write.dismiss();
  try {
    await work();
  } catch (error_) {
    error.value = errorCode(error_);
    if (error_ instanceof ApiError && error_.denied) {
      if (
        keepCredentialOn403 &&
        error_.status === 403 &&
        error_.code !== 'unauthenticated'
      ) {
        studentProfile.value = undefined;
      } else {
        clearSensitive();
      }
    }
  } finally {
    busy.value = false;
  }
}

async function runWrite<B, R>(
  signature: string,
  body: B,
  send: (frozen: B, key: string) => Promise<R>,
  apply: (result: R) => void,
) {
  if (locked.value) return;
  error.value = '';
  notice.value = '';
  pendingApply = (result) => apply(result as R);
  const result = await write.run(signature, body, send);
  if (result !== undefined) {
    pendingApply = undefined;
    apply(result);
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
    apply?.(result);
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
  await readAction(async () => {
    const after = append ? cursor.value : '';
    const school = encodeURIComponent(schoolId.value);
    if (!append) {
      reviewing.value = undefined;
      clearPictures();
    }
    switch (tab.value) {
      case 'configuration': {
        try {
          Object.assign(
            config,
            await api.get(
              'School',
              `/api/v1/admin/verification/schools/${school}`,
            ),
          );
        } catch (error_) {
          if (errorCode(error_) !== 'not_found') throw error_;
          Object.assign(config, blankSchool(schoolId.value));
        }
        materialTypes.value = config.material_types.join(', ');
        cursor.value = '';
        break;
      }
      case 'jobs': {
        const page = await api.list(
          'Job',
          `/api/v1/admin/verification/jobs?school_id=${school}`,
          { after },
        );
        jobs.value = append ? [...jobs.value, ...page.items] : page.items;
        cursor.value = page.next;
        break;
      }
      case 'requests': {
        const page = await api.list(
          'RemovalRequest',
          `/api/v1/admin/verification/schools/${school}/requests`,
          { after },
        );
        removals.value = append
          ? [...removals.value, ...page.items]
          : page.items;
        cursor.value = page.next;
        break;
      }
      case 'reviews': {
        const page = await api.list(
          'Application',
          `/api/v1/admin/verification/schools/${school}/applications`,
          { after },
        );
        applications.value = append
          ? [...applications.value, ...page.items]
          : page.items;
        cursor.value = page.next;
        break;
      }
      case 'suggestions': {
        const page = await api.list(
          'Suggestion',
          '/api/v1/admin/verification/suggestions',
          { after },
        );
        suggestions.value = append
          ? [...suggestions.value, ...page.items]
          : page.items;
        cursor.value = page.next;
        break;
      }
      default: {
        cursor.value = '';
      }
    }
  });
}

async function openReview(row: Application) {
  await readAction(async () => {
    clearPictures();
    const id = encodeURIComponent(row.id);
    const form = await api.get(
      'ManualInput',
      `/api/v1/admin/verification/applications/${id}/form`,
    );
    const materials = await api.list(
      'Material',
      `/api/v1/verification/applications/${id}/materials`,
    );
    const images: typeof pictures.value = [];
    try {
      for (const material of materials.items) {
        const blob = await api.material(material.id);
        images.push({
          id: material.id,
          type: blob.type,
          url: URL.createObjectURL(blob),
        });
      }
    } catch (error_) {
      for (const image of images) URL.revokeObjectURL(image.url);
      throw error_;
    }
    reviewing.value = row;
    manual.value = form;
    pictures.value = images;
    note.value = '';
    expiry.value = undefined;
  });
}

function closeReview() {
  if (locked.value) return;
  write.dismiss();
  reviewing.value = undefined;
  clearPictures();
}

async function review(decision: Schemas['ReviewInput']['decision']) {
  const row = reviewing.value;
  if (!row) return;
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
    () => {
      applications.value = applications.value.filter(
        (item) => item.id !== row.id,
      );
      reviewing.value = undefined;
      clearPictures();
      notice.value = t('page.common.saved');
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
      removals.value = removals.value.filter((item) => item.id !== row.id);
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
      suggestions.value = suggestions.value.map((item) =>
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
      jobs.value = jobs.value.map((item) =>
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
      materialTypes.value = saved.material_types.join(', ');
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
  cursor.value = '';
  applications.value = [];
  removals.value = [];
  jobs.value = [];
  if (access.value === 'allowed' && schoolId.value) void load();
});
watch(tab, () => {
  if (write.uncertain.value) return;
  cursor.value = '';
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
        v-if="error && !reviewing"
        type="error"
        show-icon
        role="alert"
        :message="errorText(error)"
      />
      <Card :bordered="false">
        <Tabs v-model:active-key="tab">
          <TabPane
            key="reviews"
            :tab="t('page.verification.tabs.reviews')"
            :disabled="locked"
          >
            <Table
              :columns="applicationColumns"
              :data-source="applications"
              :pagination="false"
              row-key="id"
              size="middle"
              :loading="busy && !reviewing"
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
                  <Tag>{{ label(`page.verification.states.${record.state}`) }}</Tag>
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
              v-if="removals.length === 0 && !busy"
              class="text-muted-foreground"
            >
              {{ t('page.verification.noRequests') }}
            </p>
            <Card
              v-for="row in removals"
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
                  <Tag>{{ label(`page.verification.states.${credential.state}`) }}</Tag>
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
              <Space>
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
              :data-source="jobs"
              :pagination="false"
              row-key="id"
              size="middle"
              :loading="busy"
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
              v-if="suggestions.length === 0 && !busy"
              class="text-muted-foreground"
            >
              {{ t('page.common.empty') }}
            </p>
            <Card
              v-for="row in suggestions"
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
                <Tag>{{ label(`page.verification.states.${row.state}`) }}</Tag>
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
          <Button v-if="cursor" :disabled="locked" @click="load(true)">
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
        <div class="grid gap-3 sm:grid-cols-2">
          <template v-for="(picture, index) in pictures" :key="picture.id">
            <Image
              v-if="picture.type.startsWith('image/')"
              :src="picture.url"
              :alt="t('page.verification.material', { index: index + 1 })"
            />
            <a
              v-else
              :href="picture.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ t('page.verification.material', { index: index + 1 }) }}
            </a>
          </template>
        </div>
        <Form layout="vertical">
          <FormItem
            :label="t('page.verification.note')"
            html-for="verificationview-field-13"
          >
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
          v-if="error"
          type="error"
          show-icon
          role="alert"
          :message="errorText(error)"
        />
      </div>
    </Drawer>
  </AdminPage>
</template>
