<script setup lang="ts">
import type {
  Application,
  Schemas,
  School,
  TeacherCredential,
  TeacherForm,
} from './api';

import type { CatalogObject } from '#/features/academic/api';

import {
  computed,
  getCurrentInstance,
  inject,
  onBeforeUnmount,
  onMounted,
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
  DatePicker,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Form,
  FormItem,
  Input,
  Result,
  Select,
  Space,
  Table,
  TabPane,
  Tabs,
  Tag,
  Textarea,
} from 'ant-design-vue';

import { useAcademicAdmin } from '#/features/academic/api';
import { ApiError, errorCode, isDeniedCode } from '#/shared/api/errors';
import { useMutation, usePaged, useTask } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import { sessionKey } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import MaterialPreview from '#/shared/ui/MaterialPreview.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';
import ReasonPresets from '#/shared/ui/ReasonPresets.vue';

import { useVerification } from './api';
import SchoolSelect from './SchoolSelect.vue';

/**
 * Teacher verification per school: review photographed teaching evidence and
 * bind the applicant to canonical catalog teacher profiles, or look up a
 * teacher qualification and revoke it. Teacher review is independent of student
 * verification; the server rejects self-review and teachers from another school.
 */
type Tab = 'credentials' | 'reviews';
interface Picture {
  id: string;
  objectUrl?: string;
  size?: number;
  tooLarge?: boolean;
  type: string;
  url?: string;
}

const inlinePreviewLimit = 15 * 1024 * 1024;
const applicationStates: Application['state'][] = ['pending_review', 'supplement_required', 'approved', 'rejected', 'expired', 'deleted'];
const presetKeys = ['blurry', 'teacherProof', 'mismatch', 'wrongType'] as const;

const { t } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useVerification();
const catalog = useAcademicAdmin();
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
const busy = readTask.busy;
const error = ref('');
const notice = ref('');

let pendingApply: ((result: unknown) => Promise<void> | void) | undefined;

const activeError = computed(() => error.value || applications.error.value);
const locked = computed(
  () => busy.value || applications.status.value === 'loading' || write.busy.value || write.uncertain.value,
);

// Pending teacher applications of the chosen school, ordered by ID.
const applications = usePaged<Application>(
  async (after, signal) => {
    if (!schoolId.value) return { items: [], next: '' };
    return api.list(
      'Application',
      `/api/v1/admin/verification/schools/${encodeURIComponent(schoolId.value)}/teacher-applications`,
      { after, signal },
    );
  },
  { onDenied: deniedList },
);

// Review drawer: the submitted form, its materials and the teacher profiles to bind.
const reviewing = shallowRef<Application>();
const form = shallowRef<TeacherForm>();
const pictures = ref<Picture[]>([]);
const note = ref('');
const expiry = ref<string>();
const teacherIds = ref<string[]>([]);
const teacherOptions = ref<CatalogObject[]>([]);
const searching = ref(false);
let searchSeq = 0;

// Qualification lookup and revocation.
const credentialId = ref('');
const credential = shallowRef<TeacherCredential>();
const credentialNames = ref(new Map<string, CatalogObject>());
const revokeNote = ref('');

const visibleApplications = computed(() =>
  stateFilter.value ? applications.items.value.filter((item) => item.state === stateFilter.value) : applications.items.value,
);
const teacherPresets = computed(() =>
  presetKeys.map((key) => ({ key, text: t(`page.verification.presets.${key}`) })),
);
const stateOptions = computed(() => [
  { value: '', label: t('page.common.all') },
  ...applicationStates.map((value) => ({ value, label: t(`page.verification.states.${value}`) })),
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
  searchSeq++;
  searching.value = false;
  teacherIds.value = [];
  teacherOptions.value = [];
  revokeNote.value = '';
  note.value = '';
  notice.value = '';
  reviewing.value = undefined;
  form.value = undefined;
  credential.value = undefined;
  credentialNames.value = new Map();
  clearPictures();
}

watch(
  () => session?.state.value,
  (state) => {
    if (state === 'guest') clearSensitive();
  },
);

async function readAction(work: () => Promise<void>) {
  if (locked.value) return;
  error.value = '';
  notice.value = '';
  write.dismiss();
  await readTask.run(work);
  error.value = readTask.error.value;
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
  if (!schoolId.value) return;
  await (append ? applications.loadMore() : applications.reload());
}

async function loadReviewTarget(row: Application) {
  clearPictures();
  const id = encodeURIComponent(row.id);
  const submitted = await api.get('TeacherForm', `/api/v1/admin/verification/applications/${id}/teacher-form`);
  const images: Picture[] = [];
  try {
    for (const materialId of submitted.material_ids) {
      try {
        const blob = await api.material(materialId);
        if (blob.size > inlinePreviewLimit) {
          images.push({ id: materialId, size: blob.size, tooLarge: true, type: blob.type });
        } else {
          const objectUrl = URL.createObjectURL(blob);
          images.push({ id: materialId, objectUrl, size: blob.size, type: blob.type, url: objectUrl });
        }
      } catch (error_) {
        if (errorCode(error_) === 'capacity_exceeded') {
          images.push({ id: materialId, tooLarge: true, type: 'application/pdf' });
        } else {
          throw error_;
        }
      }
    }
  } catch (error_) {
    for (const image of images) {
      if (image.objectUrl) URL.revokeObjectURL(image.objectUrl);
    }
    throw error_;
  }
  reviewing.value = row;
  form.value = submitted;
  pictures.value = images;
  note.value = '';
  expiry.value = undefined;
  teacherIds.value = [];
  teacherOptions.value = [];
  void searchTeachers(submitted.name);
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
  if (dirty.value && !window.confirm(t('page.common.leaveUnsaved'))) return;
  await openReview(target);
}
async function openReview(row: Application) {
  await readAction(() => loadReviewTarget(row));
}
async function searchTeachers(query: string) {
  const school = reviewing.value?.school_id;
  if (!school) return;
  const seq = ++searchSeq;
  searching.value = true;
  try {
    const page = await catalog.objects({
      kind: 'teacher',
      school_id: school,
      q: query.trim() || undefined,
      limit: 20,
    });
    if (seq !== searchSeq) return;
    // Keep chosen profiles visible while the search shows other names.
    const chosen = teacherOptions.value.filter((item) =>
      teacherIds.value.includes(item.id),
    );
    teacherOptions.value = [
      ...chosen,
      ...page.items.filter((item) => !teacherIds.value.includes(item.id)),
    ];
  } catch (error_) {
    if (seq === searchSeq) error.value = errorCode(error_);
  } finally {
    if (seq === searchSeq) searching.value = false;
  }
}

const dirty = computed(
  () =>
    (!!reviewing.value &&
      (!!note.value.trim() || teacherIds.value.length > 0)) ||
    !!revokeNote.value.trim(),
);
useLeaveGuard(() => {
  if (write.uncertain.value) return t('page.common.leaveUncertain');
  return dirty.value || locked.value ? t('page.common.leaveUnsaved') : '';
});

function closeReview() {
  if (locked.value || (dirty.value && !window.confirm(t('page.common.leaveUnsaved')))) return;
  write.dismiss();
  reviewing.value = undefined;
  clearPictures();
}

async function review(decision: Schemas['TeacherReviewInput']['decision']) {
  const row = reviewing.value;
  if (!row) return;
  const following = neighbour(1);
  const body: Schemas['TeacherReviewInput'] = {
    decision,
    note: note.value.trim(),
    revision: row.revision,
    teacher_ids: decision === 'approve' ? [...teacherIds.value] : [],
    ...(decision === 'approve' ? { expires_at: expiry.value ?? null } : {}),
  };
  await runWrite(
    `teacher-review:${row.id}:${row.revision}`,
    body,
    (frozen, key) =>
      api.write(
        'Application',
        `/api/v1/admin/verification/applications/${encodeURIComponent(row.id)}/teacher-review`,
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
      notice.value = t(`page.teacherVerification.done.${decision}`);
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

async function lookupCredential() {
  await readAction(async () => {
    credential.value = undefined;
    revokeNote.value = '';
    const found = await api.get(
      'TeacherCredential',
      `/api/v1/admin/verification/teacher-credentials/${encodeURIComponent(credentialId.value.trim())}`,
    );
    credentialNames.value = await catalog
      .lookup(found.teacher_ids)
      .catch(() => new Map<string, CatalogObject>());
    credential.value = found;
  });
}

async function revoke() {
  const current = credential.value;
  if (!current || !revokeNote.value.trim()) return;
  const body: Schemas['DecisionInput'] = {
    approve: true,
    note: revokeNote.value.trim(),
    revision: current.revision,
  };
  await runWrite(
    `teacher-revoke:${current.id}:${current.revision}`,
    body,
    (frozen, key) =>
      api.write(
        'TeacherCredential',
        `/api/v1/admin/verification/teacher-credentials/${encodeURIComponent(current.id)}/revoke`,
        frozen,
        'POST',
        undefined,
        key,
      ),
    (updated) => {
      credential.value = updated;
      revokeNote.value = '';
      notice.value = t('page.teacherVerification.revoked');
    },
  );
}

watch(credentialId, () => {
  if (write.uncertain.value) return;
  credential.value = undefined;
});

watch(schoolId, () => {
  if (write.uncertain.value) return;
  applications.clear();
  void load();
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

const schoolName = (id: string) =>
  schools.value.find((item) => item.id === id)?.name ?? id;
const columns = computed(() => [
  { key: 'state', title: t('page.common.status') },
  { key: 'created', title: t('page.common.createdAt') },
  { key: 'updated', title: t('page.common.updatedAt') },
  { key: 'action', title: t('page.common.operation') },
]);
const disclosureText = (items: readonly string[]) =>
  items.length > 0
    ? format.value.list(
        items.map((item) => t(`page.teacherVerification.disclosure.${item}`)),
      )
    : t('page.teacherVerification.nothingPublic');
function chooseSchool(school: School) {
  schools.value = [
    ...new Map([...schools.value, school].map((item) => [item.id, item])).values(),
  ];
  schoolId.value = school.id;
}
</script>

<template>
  <AdminPage
    :title="t('page.teacherVerification.title')"
    :description="t('page.teacherVerification.intro')"
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
            :tab="t('page.teacherVerification.tabs.reviews')"
            :disabled="locked"
          >
            <Form layout="inline" class="mb-4">
              <FormItem :label="t('page.common.school')" html-for="teacher-school">
                <SchoolSelect
                  input-id="teacher-school"
                  :model-value="schoolId"
                  :schools="schools"
                  class="w-64 max-w-full"
                  :disabled="locked"
                  @select="chooseSchool"
                />
              </FormItem>
              <FormItem :label="t('page.common.status')" html-for="teacher-state-filter">
                <Select id="teacher-state-filter" v-model:value="stateFilter" class="w-44 max-w-full" :disabled="locked" :options="stateOptions" />
              </FormItem>
              <FormItem>
                <Button :disabled="locked || !schoolId" @click="load()">
                  {{ t('page.common.refresh') }}
                </Button>
              </FormItem>
            </Form>
            <Table
              :columns="columns"
              :data-source="visibleApplications"
              :pagination="false"
              row-key="id"
              size="middle"
              :loading="applications.status.value === 'loading' && !applications.appending.value"
              :scroll="{ x: 560 }"
              :locale="{ emptyText: t('page.teacherVerification.empty') }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'state'">
                  <Tag>{{ t(`page.verification.states.${record.state}`) }}</Tag>
                </template>
                <template v-else-if="column.key === 'created'">
                  {{ format.dateTime(record.created_at) }}
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
            <div class="mt-4 flex justify-center">
              <Button v-if="applications.next.value" :disabled="locked" @click="load(true)">
                {{ t('page.common.loadMore') }}
              </Button>
            </div>
          </TabPane>
          <TabPane
            key="credentials"
            :tab="t('page.teacherVerification.tabs.credentials')"
            :disabled="locked"
          >
            <Form layout="inline" class="mb-4" @submit.prevent="lookupCredential">
              <FormItem
                :label="t('page.teacherVerification.credentialId')"
                html-for="teacher-credential-id"
              >
                <Input
                  id="teacher-credential-id"
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
                <DescriptionsItem :label="t('page.common.school')">
                  {{ schoolName(credential.school_id) }}
                </DescriptionsItem>
                <DescriptionsItem :label="t('page.common.status')">
                  <Tag :color="credential.state === 'active' ? 'green' : undefined">
                    {{ t(`page.verification.states.${credential.state}`) }}
                  </Tag>
                </DescriptionsItem>
                <DescriptionsItem :label="t('page.teacherVerification.profiles')">
                  {{
                    format.list(
                      credential.teacher_ids.map(
                        (id) => credentialNames.get(id)?.name ?? id,
                      ),
                    )
                  }}
                </DescriptionsItem>
                <DescriptionsItem :label="t('page.teacherVerification.public')">
                  {{ disclosureText(credential.disclosures) }}
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
                <DescriptionsItem
                  v-if="credential.note"
                  :label="t('page.verification.note')"
                >
                  {{ credential.note }}
                </DescriptionsItem>
              </Descriptions>
              <template v-if="credential.state === 'active'">
                <p class="text-muted-foreground mb-2 text-sm">
                  {{ t('page.teacherVerification.revokeHint') }}
                </p>
                <FormItem
                  :label="t('page.common.reason')"
                  required
                  html-for="teacher-revoke-note"
                >
                  <Textarea
                    id="teacher-revoke-note"
                    v-model:value="revokeNote"
                    :rows="2"
                    :maxlength="500"
                    :disabled="locked"
                  />
                </FormItem>
                <Button
                  danger
                  :loading="write.busy.value"
                  :disabled="locked || !revokeNote.trim()"
                  @click="revoke"
                >
                  {{ t('page.verification.revoke') }}
                </Button>
              </template>
            </template>
          </TabPane>
        </Tabs>
      </Card>
    </div>

    <Drawer
      :open="!!reviewing"
      :width="760"
      :title="t('page.teacherVerification.reviewTitle')"
      :closable="!locked"
      :keyboard="!locked"
      :mask-closable="false"
      destroy-on-close
      @close="closeReview"
    >
      <div v-if="reviewing && form" class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Checkbox v-model:checked="autoNext" :disabled="locked">{{ t('page.moderation.autoNext') }}</Checkbox>
          <Space>
            <Button size="small" :disabled="locked || !neighbour(-1)" @click="moveReview(-1)">{{ t('page.moderation.previous') }}</Button>
            <Button size="small" :disabled="locked || !neighbour(1)" @click="moveReview(1)">{{ t('page.moderation.next') }}</Button>
          </Space>
        </div>
        <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
          <DescriptionsItem :label="t('page.common.school')">
            {{ schoolName(reviewing.school_id) }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.name')">
            {{ form.name }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherVerification.organization')">
            {{ form.organization }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherVerification.gender')">
            {{ form.gender || t('page.common.notProvided') }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.email')">
            {{ form.email }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.materialType')">
            {{ form.material_type }}
          </DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherVerification.public')">
            {{ disclosureText(form.disclosures) }}
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
            :label="t('page.teacherVerification.profiles')"
            :extra="t('page.teacherVerification.profilesHint')"
            html-for="teacher-profiles"
          >
            <Select
              id="teacher-profiles"
              v-model:value="teacherIds"
              mode="multiple"
              show-search
              :filter-option="false"
              :loading="searching"
              :disabled="locked"
              :options="
                teacherOptions.map((item) => ({ value: item.id, label: item.name }))
              "
              :not-found-content="t('page.teacherVerification.noTeachers')"
              @search="searchTeachers"
            />
          </FormItem>
          <FormItem
            :label="t('page.verification.expiresAt')"
            :extra="t('page.teacherVerification.expiryHint')"
            html-for="teacher-expiry"
          >
            <DatePicker
              id="teacher-expiry"
              v-model:value="expiry"
              show-time
              value-format="YYYY-MM-DDTHH:mm:ssZ"
              :disabled="locked"
            />
          </FormItem>
          <FormItem
            :label="t('page.verification.note')"
            :extra="t('page.teacherVerification.noteHint')"
            html-for="teacher-review-note"
          >
            <ReasonPresets v-model="note" :presets="teacherPresets" :disabled="locked" :max-length="500" />
            <Textarea
              id="teacher-review-note"
              v-model:value="note"
              :rows="3"
              :maxlength="500"
              :disabled="locked"
            />
          </FormItem>
        </Form>
        <Space wrap>
          <Button
            type="primary"
            :loading="write.busy.value"
            :disabled="locked || teacherIds.length === 0"
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
