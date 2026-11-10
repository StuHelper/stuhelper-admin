<script setup lang="ts">
import type { Application, Schemas, School, TeacherCredential, TeacherForm } from './api';

import type { CatalogObject } from '#/features/academic/api';

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, DatePicker, Descriptions, DescriptionsItem, Drawer, Form, FormItem, Image, Input, Result, Select, Space, Table, TabPane, Tabs, Tag, Textarea } from 'ant-design-vue';

import { useAcademicAdmin } from '#/features/academic/api';
import { errorCode } from '#/shared/api/errors';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';

import { useVerification } from './api';
import SchoolSelect from './SchoolSelect.vue';

/**
 * Teacher verification per school: review photographed teaching evidence and
 * bind the applicant to canonical catalog teacher profiles, or look up a
 * teacher qualification and revoke it. Teacher review is independent of student
 * verification; the server rejects self-review and teachers from another school.
 */
type Tab = 'credentials' | 'reviews';
type Picture = { id: string; type: string; url: string };
const { t } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const api = useVerification();
const catalog = useAcademicAdmin();

const access = ref<'allowed' | 'checking' | 'denied' | 'error'>('checking');
const accessError = ref('');
const schools = ref<School[]>([]);
const schoolId = ref('');
const tab = ref<Tab>('reviews');
const busy = ref(false);
const error = ref('');
const notice = ref('');

async function action(work: () => Promise<void>, done = '') {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await work();
    notice.value = done;
  } catch (error_) {
    error.value = errorCode(error_);
  } finally {
    busy.value = false;
  }
}

// Pending teacher applications of the chosen school, ordered by ID.
const applications = ref<Application[]>([]);
const cursor = ref('');
async function load(append = false) {
  if (!schoolId.value) return;
  await action(async () => {
    const page = await api.list('Application', `/api/v1/admin/verification/schools/${encodeURIComponent(schoolId.value)}/teacher-applications`, { after: append ? cursor.value : '' });
    applications.value = append ? [...applications.value, ...page.items] : page.items;
    cursor.value = page.next;
  });
}

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
function clearPictures() {
  for (const picture of pictures.value) URL.revokeObjectURL(picture.url);
  pictures.value = [];
}
async function openReview(row: Application) {
  await action(async () => {
    clearPictures();
    const id = encodeURIComponent(row.id);
    const submitted = await api.get('TeacherForm', `/api/v1/admin/verification/applications/${id}/teacher-form`);
    const images: Picture[] = [];
    try {
      for (const materialId of submitted.material_ids) {
        const blob = await api.material(materialId);
        images.push({ id: materialId, type: blob.type, url: URL.createObjectURL(blob) });
      }
    } catch (error_) {
      for (const image of images) URL.revokeObjectURL(image.url);
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
  });
}
async function searchTeachers(query: string) {
  const school = reviewing.value?.school_id;
  if (!school) return;
  const seq = ++searchSeq;
  searching.value = true;
  try {
    const page = await catalog.objects({ kind: 'teacher', school_id: school, q: query.trim() || undefined, limit: 20 });
    if (seq !== searchSeq) return;
    // Keep chosen profiles visible while the search shows other names.
    const chosen = teacherOptions.value.filter((item) => teacherIds.value.includes(item.id));
    teacherOptions.value = [...chosen, ...page.items.filter((item) => !teacherIds.value.includes(item.id))];
  } catch (error_) {
    if (seq === searchSeq) error.value = errorCode(error_);
  } finally {
    if (seq === searchSeq) searching.value = false;
  }
}
const dirty = computed(() => !!reviewing.value && (!!note.value.trim() || teacherIds.value.length > 0));
useLeaveGuard(() => (dirty.value || busy.value ? t('page.common.leaveUnsaved') : ''));
function closeReview() {
  if (busy.value) return;
  reviewing.value = undefined;
  clearPictures();
}
async function review(decision: Schemas['TeacherReviewInput']['decision']) {
  const row = reviewing.value;
  if (!row) return;
  await action(async () => {
    const body: Schemas['TeacherReviewInput'] = { decision, note: note.value.trim(), revision: row.revision, teacher_ids: decision === 'approve' ? teacherIds.value : [], ...(decision === 'approve' ? { expires_at: expiry.value ?? null } : {}) };
    await api.write('Application', `/api/v1/admin/verification/applications/${encodeURIComponent(row.id)}/teacher-review`, body);
    applications.value = applications.value.filter((item) => item.id !== row.id);
    reviewing.value = undefined;
    clearPictures();
  }, t(`page.teacherVerification.done.${decision}`));
}

// Qualification lookup and revocation.
const credentialId = ref('');
const credential = shallowRef<TeacherCredential>();
const credentialNames = ref(new Map<string, CatalogObject>());
const revokeNote = ref('');
async function lookupCredential() {
  await action(async () => {
    credential.value = undefined;
    revokeNote.value = '';
    const found = await api.get('TeacherCredential', `/api/v1/admin/verification/teacher-credentials/${encodeURIComponent(credentialId.value.trim())}`);
    credentialNames.value = await catalog.lookup(found.teacher_ids).catch(() => new Map<string, CatalogObject>());
    credential.value = found;
  });
}
async function revoke() {
  const current = credential.value;
  if (!current || !revokeNote.value.trim()) return;
  await action(async () => {
    const body: Schemas['DecisionInput'] = { approve: true, note: revokeNote.value.trim(), revision: current.revision };
    credential.value = await api.write('TeacherCredential', `/api/v1/admin/verification/teacher-credentials/${encodeURIComponent(current.id)}/revoke`, body);
    revokeNote.value = '';
  }, t('page.teacherVerification.revoked'));
}
watch(credentialId, () => {
  credential.value = undefined;
});

watch(schoolId, () => {
  applications.value = [];
  cursor.value = '';
  void load();
});
onMounted(async () => {
  try {
    await api.consoleAccess();
    access.value = 'allowed';
    const page = await api.list('School', '/api/v1/verification/schools', { limit: 100 });
    schools.value = page.items;
    schoolId.value = schools.value[0]?.id ?? '';
  } catch (error_) {
    accessError.value = errorCode(error_);
    access.value = accessError.value === 'forbidden' || accessError.value === 'unauthenticated' ? 'denied' : 'error';
  }
});
onBeforeUnmount(clearPictures);

const schoolName = (id: string) => schools.value.find((item) => item.id === id)?.name ?? id;
const columns = computed(() => [
  { key: 'state', title: t('page.common.status') },
  { key: 'created', title: t('page.common.createdAt') },
  { key: 'updated', title: t('page.common.updatedAt') },
  { key: 'action', title: t('page.common.operation') },
]);
const disclosureText = (items: readonly string[]) => (items.length > 0 ? format.value.list(items.map((item) => t(`page.teacherVerification.disclosure.${item}`))) : t('page.teacherVerification.nothingPublic'));
function chooseSchool(school: School) {
  schools.value = [...new Map([...schools.value, school].map((item) => [item.id, item])).values()];
  schoolId.value = school.id;
}
</script>

<template>
  <AdminPage :title="t('page.teacherVerification.title')" :description="t('page.teacherVerification.intro')">
    <Card v-if="access === 'checking'" :bordered="false" :loading="true" />
    <Result v-else-if="access !== 'allowed'" :status="access === 'denied' ? '403' : 'warning'" :title="t(access === 'denied' ? 'page.verification.noAccess' : 'page.errors.unavailable')" :sub-title="errorText(accessError)" />
    <div v-else class="flex flex-col gap-4">
      <Alert v-if="error && !reviewing" type="error" show-icon role="alert" :message="errorText(error)" />
      <Alert v-if="notice" type="success" show-icon role="status" :message="notice" />
      <Card :bordered="false">
        <Tabs v-model:active-key="tab">
          <TabPane key="reviews" :tab="t('page.teacherVerification.tabs.reviews')">
            <Form layout="inline" class="mb-4">
              <FormItem :label="t('page.common.school')" html-for="teacher-school">
                <SchoolSelect input-id="teacher-school" :model-value="schoolId" :schools="schools" class="w-64 max-w-full" :disabled="busy" @select="chooseSchool" />
              </FormItem>
              <FormItem><Button :disabled="busy || !schoolId" @click="load()">{{ t('page.common.refresh') }}</Button></FormItem>
            </Form>
            <Table :columns="columns" :data-source="applications" :pagination="false" row-key="id" size="middle" :loading="busy && !reviewing" :scroll="{ x: 560 }" :locale="{ emptyText: t('page.teacherVerification.empty') }">
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'state'"><Tag>{{ t(`page.verification.states.${record.state}`) }}</Tag></template>
                <template v-else-if="column.key === 'created'">{{ format.dateTime(record.created_at) }}</template>
                <template v-else-if="column.key === 'updated'">{{ format.dateTime(record.updated_at) }}</template>
                <template v-else-if="column.key === 'action'"><Button type="link" size="small" :disabled="busy" @click="openReview(record as Application)">{{ t('page.verification.review') }}</Button></template>
              </template>
            </Table>
            <div class="mt-4 flex justify-center">
              <Button v-if="cursor" :disabled="busy" @click="load(true)">{{ t('page.common.loadMore') }}</Button>
            </div>
          </TabPane>
          <TabPane key="credentials" :tab="t('page.teacherVerification.tabs.credentials')">
            <Form layout="inline" class="mb-4" @submit.prevent="lookupCredential">
              <FormItem :label="t('page.teacherVerification.credentialId')" html-for="teacher-credential-id">
                <Input id="teacher-credential-id" v-model:value="credentialId" :maxlength="128" class="w-80 max-w-full" />
              </FormItem>
              <FormItem><Button html-type="submit" :disabled="busy || !credentialId.trim()">{{ t('page.common.search') }}</Button></FormItem>
            </Form>
            <template v-if="credential">
              <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered class="mb-4">
                <DescriptionsItem :label="t('page.common.school')">{{ schoolName(credential.school_id) }}</DescriptionsItem>
                <DescriptionsItem :label="t('page.common.status')"><Tag :color="credential.state === 'active' ? 'green' : undefined">{{ t(`page.verification.states.${credential.state}`) }}</Tag></DescriptionsItem>
                <DescriptionsItem :label="t('page.teacherVerification.profiles')">{{ format.list(credential.teacher_ids.map((id) => credentialNames.get(id)?.name ?? id)) }}</DescriptionsItem>
                <DescriptionsItem :label="t('page.teacherVerification.public')">{{ disclosureText(credential.disclosures) }}</DescriptionsItem>
                <DescriptionsItem :label="t('page.verification.verifiedAt')">{{ format.dateTime(credential.verified_at) }}</DescriptionsItem>
                <DescriptionsItem :label="t('page.verification.expiresAt')">{{ credential.expires_at ? format.dateTime(credential.expires_at) : t('page.verification.permanent') }}</DescriptionsItem>
                <DescriptionsItem v-if="credential.note" :label="t('page.verification.note')">{{ credential.note }}</DescriptionsItem>
              </Descriptions>
              <template v-if="credential.state === 'active'">
                <p class="text-muted-foreground mb-2 text-sm">{{ t('page.teacherVerification.revokeHint') }}</p>
                <FormItem :label="t('page.common.reason')" required html-for="teacher-revoke-note">
                  <Textarea id="teacher-revoke-note" v-model:value="revokeNote" :rows="2" :maxlength="500" :disabled="busy" />
                </FormItem>
                <Button danger :loading="busy" :disabled="!revokeNote.trim()" @click="revoke">{{ t('page.verification.revoke') }}</Button>
              </template>
            </template>
          </TabPane>
        </Tabs>
      </Card>
    </div>

    <Drawer :open="!!reviewing" :width="760" :title="t('page.teacherVerification.reviewTitle')" :mask-closable="false" destroy-on-close @close="closeReview">
      <div v-if="reviewing && form" class="flex flex-col gap-4">
        <Descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
          <DescriptionsItem :label="t('page.common.school')">{{ schoolName(reviewing.school_id) }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.name')">{{ form.name }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherVerification.organization')">{{ form.organization }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherVerification.gender')">{{ form.gender || t('page.common.notProvided') }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.email')">{{ form.email }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.verification.materialType')">{{ form.material_type }}</DescriptionsItem>
          <DescriptionsItem :label="t('page.teacherVerification.public')">{{ disclosureText(form.disclosures) }}</DescriptionsItem>
        </Descriptions>
        <div class="grid gap-3 sm:grid-cols-2">
          <template v-for="(picture, index) in pictures" :key="picture.id">
            <Image v-if="picture.type.startsWith('image/')" :src="picture.url" :alt="t('page.verification.material', { index: index + 1 })" />
            <a v-else :href="picture.url" target="_blank" rel="noopener noreferrer">{{ t('page.verification.material', { index: index + 1 }) }}</a>
          </template>
        </div>
        <Form layout="vertical">
          <FormItem :label="t('page.teacherVerification.profiles')" :extra="t('page.teacherVerification.profilesHint')" html-for="teacher-profiles">
            <Select
              id="teacher-profiles"
              v-model:value="teacherIds"
              mode="multiple"
              show-search
              :filter-option="false"
              :loading="searching"
              :disabled="busy"
              :options="teacherOptions.map((item) => ({ value: item.id, label: item.name }))"
              :not-found-content="t('page.teacherVerification.noTeachers')"
              @search="searchTeachers"
            />
          </FormItem>
          <FormItem :label="t('page.verification.expiresAt')" :extra="t('page.teacherVerification.expiryHint')" html-for="teacher-expiry">
            <DatePicker id="teacher-expiry" v-model:value="expiry" show-time value-format="YYYY-MM-DDTHH:mm:ssZ" :disabled="busy" />
          </FormItem>
          <FormItem :label="t('page.verification.note')" :extra="t('page.teacherVerification.noteHint')" html-for="teacher-review-note">
            <Textarea id="teacher-review-note" v-model:value="note" :rows="3" :maxlength="500" :disabled="busy" />
          </FormItem>
        </Form>
        <Space wrap>
          <Button type="primary" :loading="busy" :disabled="teacherIds.length === 0" @click="review('approve')">{{ t('page.verification.approve') }}</Button>
          <Button :disabled="busy || !note.trim()" @click="review('supplement')">{{ t('page.verification.supplement') }}</Button>
          <Button danger :disabled="busy || !note.trim()" @click="review('reject')">{{ t('page.verification.reject') }}</Button>
        </Space>
        <Alert v-if="error" type="error" show-icon role="alert" :message="errorText(error)" />
      </div>
    </Drawer>
  </AdminPage>
</template>
