<script setup lang="ts">
import type { HomepageRequest, RequestDecision, RequestFilter } from './requestApi';

import type { ApiError } from '#/shared/api/errors';

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Form,
  FormItem,
  Input,
  Radio,
  RadioGroup,
  Select,
  Table,
  Tag,
  Textarea,
} from 'ant-design-vue';

import { useAsync, useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';
import { stateColor } from '#/shared/ui/state-color';

import { useCampusId } from '../academic/campus';
import CampusPending from '../academic/CampusPending.vue';
import { useTeacherHomepageAccess } from './access';
import { useTeacherHomepageProfile } from './profileApi';
import {
  buildRequestDecision,
  decisionNoteLimit,
  useTeacherHomepageRequests,
} from './requestApi';
import RequestValue from './RequestValue.vue';

const { t } = useI18n();
const format = useFormat();
const school = useCampusId();
const access = useTeacherHomepageAccess();
const api = useTeacherHomepageRequests();
const profile = useTeacherHomepageProfile();

const statusFilter = ref<NonNullable<RequestFilter['status']>>('pending');
const teacherFilter = ref('');
const filters = shallowRef<RequestFilter>({ status: 'pending' });
const selectedId = ref('');
const action = ref<RequestDecision['action']>();
const note = ref('');
const conflict = ref(false);
const savedStatus = ref<HomepageRequest['status']>();
const denial = ref('');

const deciding = shallowRef(useMutation());
const locked = computed(
  () => deciding.value.busy.value || deciding.value.uncertain.value,
);

const requests = usePaged(async (after, signal) => {
  const target = school.value;
  const page = await api.list(target, { ...filters.value, after, limit: 20 }, signal);
  if (!signal.aborted) access.reportMaintain(target, true);
  return page;
}, { onDenied: readDenied });

const detail = useAsync(async (signal) => {
  const target = school.value;
  const value = await api.get(target, selectedId.value, signal);
  if (!signal.aborted) access.reportMaintain(target, true);
  return value;
}, { onDenied: readDenied });

const controls = useAsync(async (signal) => {
  const teacher = detail.data.value?.teacher_id;
  if (!teacher) return undefined;
  return profile.getControls(school.value, teacher, signal);
}, { onDenied: readDenied });

const photo = useAsync(async (signal) => {
  const contentType = detail.data.value?.value?.photo?.content_type;
  if (!contentType) return undefined;
  return api.photo(school.value, selectedId.value, contentType, signal);
}, { onDenied: readDenied });
const photoUrl = ref('');
const brokenPhoto = ref(false);
watch(() => photo.data.value, (blob, _, onCleanup) => {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  photoUrl.value = url;
  onCleanup(() => {
    URL.revokeObjectURL(url);
    photoUrl.value = '';
  });
}, { flush: 'sync' });

const current = computed(() => detail.data.value);
const noteTooLong = computed(() => [...note.value.trim()].length > decisionNoteLimit);
const availableDecision = computed(() => current.value && buildRequestDecision(
  current.value,
  action.value,
  note.value,
  controls.data.value?.controls.revision,
));

let active = true;
onBeforeUnmount(() => {
  active = false;
});

function readDenied(cause: ApiError) {
  if (cause.status === 403) access.reportMaintain(school.value, false);
  clearRestrictedData(cause.code);
}

function clearRestrictedData(code: string) {
  denial.value = code;
  savedStatus.value = undefined;
  requests.clear();
  clearSelection();
  deciding.value = useMutation();
}

function clearPreview() {
  photo.clear();
  brokenPhoto.value = false;
}

function clearSelection() {
  selectedId.value = '';
  detail.clear();
  controls.clear();
  clearPreview();
  note.value = '';
  action.value = undefined;
  conflict.value = false;
}

function reloadList() {
  denial.value = '';
  return requests.reload();
}

watch([school, access.owner], ([value, owner]) => {
  clearSelection();
  requests.clear();
  deciding.value = useMutation();
  savedStatus.value = undefined;
  denial.value = '';
  if (value && owner) void reloadList();
}, { immediate: true, flush: 'sync' });

useLeaveGuard(() => {
  if (deciding.value.uncertain.value) return t('page.common.leaveUncertain');
  return locked.value || note.value || action.value
    ? t('page.common.leaveUnsaved')
    : '';
});

function applyFilters() {
  if (locked.value) return;
  filters.value = {
    status: statusFilter.value,
    teacher_id: teacherFilter.value.trim() || undefined,
  };
  void reloadList();
}

async function reloadDetail() {
  const id = selectedId.value;
  if (!id || !school.value) return;
  clearPreview();
  controls.clear();
  await detail.reload();
  if (active && selectedId.value === id && current.value?.status === 'pending' && access.canMaintain.value) {
    await controls.reload();
  }
}

function open(row: HomepageRequest) {
  if (locked.value) return;
  clearSelection();
  deciding.value.dismiss();
  savedStatus.value = undefined;
  selectedId.value = row.id;
  void reloadDetail();
}

function close() {
  if (locked.value) return;
  if ((note.value || action.value) && !window.confirm(t('page.common.leaveUnsaved'))) return;
  clearSelection();
  deciding.value.dismiss();
}

function showPhoto() {
  brokenPhoto.value = false;
  return photo.reload();
}

function photoFailed() {
  photo.clear();
  brokenPhoto.value = true;
}

async function saveDecision(retry = false) {
  const target = school.value;
  const id = selectedId.value;
  const mutation = deciding.value;
  if (!target || !id || !access.canMaintain.value || mutation.busy.value) return;
  const body = availableDecision.value;
  if (retry !== mutation.uncertain.value || (!retry && !body)) return;

  conflict.value = false;
  // The stored retry uses the same schema-validated decision endpoint.
  const updated = retry
    ? (await mutation.retry() as HomepageRequest | undefined)
    : body && await mutation.run(`teacher-homepage-request:${target}:${id}`, body, (value, key) =>
        api.decide(target, id, value, key),
      );
  if (!active || deciding.value !== mutation || selectedId.value !== id) return;

  if (updated) {
    savedStatus.value = updated.status;
    detail.data.value = updated;
    controls.clear();
    clearPreview();
    note.value = '';
    action.value = undefined;
    await reloadList();
  } else if (mutation.error.value === 'unauthenticated') {
    clearRestrictedData(mutation.error.value);
  } else if (mutation.error.value === 'conflict' || mutation.error.value === 'forbidden') {
    // An approval can return 403 when the applicant's teacher binding has
    // expired. Fresh GETs still verify whether the reviewer can access the data.
    conflict.value = mutation.error.value === 'conflict';
    await Promise.all([reloadDetail(), reloadList()]);
    if (current.value && current.value.status !== 'pending') {
      note.value = '';
      action.value = undefined;
    }
  }
}

const requestStates = ['pending', 'approved', 'rejected'] as const;
const columns = computed(() => [
  { key: 'teacher', title: t('page.teacherHomepage.requests.teacherId') },
  { key: 'kind', title: t('page.teacherHomepage.requests.type') },
  { key: 'field', title: t('page.teacherHomepage.requests.field') },
  { key: 'status', title: t('page.common.status') },
  { key: 'created', title: t('page.common.createdAt') },
  { key: 'action', title: t('page.common.operation') },
]);
</script>

<template>
  <AdminPage :title="t('page.teacherHomepage.requests.title')">
    <CampusPending v-if="!school" @ready="school = $event" />
    <div v-else class="flex flex-col gap-3">
      <Alert
        v-if="savedStatus"
        type="success"
        show-icon
        closable
        role="status"
        :message="t(`page.teacherHomepage.requests.states.${savedStatus}`)"
        @close="savedStatus = undefined"
      />
      <Card :bordered="false">
        <Form layout="inline" class="flex flex-wrap gap-y-3" @submit.prevent="applyFilters">
          <FormItem :label="t('page.common.status')" html-for="homepage-request-status">
            <Select
              id="homepage-request-status"
              v-model:value="statusFilter"
              class="min-w-36"
              :disabled="locked"
              :options="[
                { label: t('page.common.all'), value: 'all' },
                ...requestStates.map((value) => ({
                  label: t(`page.teacherHomepage.requests.states.${value}`),
                  value,
                })),
              ]"
            />
          </FormItem>
          <FormItem :label="t('page.teacherHomepage.requests.teacherId')" html-for="homepage-request-teacher">
            <Input
              id="homepage-request-teacher"
              v-model:value="teacherFilter"
              allow-clear
              dir="ltr"
              :disabled="locked"
            />
          </FormItem>
          <FormItem>
            <Button type="primary" html-type="submit" :disabled="locked">
              {{ t('page.common.search') }}
            </Button>
          </FormItem>
        </Form>
      </Card>

      <Card :bordered="false">
        <LoadState
          v-if="denial || requests.items.value.length === 0"
          :status="denial ? 'error' : requests.status.value"
          :error="denial || requests.error.value"
          empty
          @retry="reloadList"
        />
        <template v-else>
          <Table :columns="columns" :data-source="requests.items.value" :pagination="false" row-key="id" size="middle" :scroll="{ x: 640 }">
            <template #bodyCell="{ column, record }">
              <bdi v-if="column.key === 'teacher'">{{ record.teacher_id }}</bdi>
              <template v-else-if="column.key === 'kind'">
                {{ t(`page.teacherHomepage.requests.kinds.${record.kind}`) }}
              </template>
              <template v-else-if="column.key === 'field'">
                {{ t(`page.teacherHomepage.fields.${record.field.field}`) }}
                <bdi v-if="record.field.label"> · {{ record.field.label }}</bdi>
              </template>
              <Tag v-else-if="column.key === 'status'" :color="stateColor(record.status)">
                {{ t(`page.teacherHomepage.requests.states.${record.status}`) }}
              </Tag>
              <template v-else-if="column.key === 'created'">{{ format.dateTime(record.created_at) }}</template>
              <Button
                v-else-if="column.key === 'action'"
                type="link"
                size="small"
                :disabled="locked || !!selectedId"
                @click="open(record as HomepageRequest)"
              >
                {{ t('page.common.open') }}
              </Button>
            </template>
          </Table>
          <LoadState
            v-if="requests.status.value === 'error'"
            :status="requests.status.value"
            :error="requests.error.value"
            @retry="requests.loadMore"
          />
        </template>
        <div v-if="requests.next.value && requests.status.value !== 'error'" class="mt-4 flex justify-center">
          <Button :loading="requests.appending.value" :disabled="locked" @click="requests.loadMore">
            {{ t('page.common.loadMore') }}
          </Button>
        </div>
      </Card>
    </div>

    <Drawer
      :open="!!selectedId"
      width="min(100vw, 680px)"
      :title="t('page.teacherHomepage.requests.detail')"
      :closable="!locked"
      :keyboard="!locked"
      :mask-closable="false"
      destroy-on-close
      @close="close"
    >
      <div class="flex flex-col gap-4">
        <Alert v-if="conflict" type="warning" show-icon role="alert" :message="t('page.teacherHomepage.requests.conflict')" />
        <MutationAlert
          :busy="deciding.busy.value"
          :uncertain="deciding.uncertain.value"
          :error="conflict ? '' : deciding.error.value"
          @retry="saveDecision(true)"
        />

        <LoadState :status="detail.status.value" :error="detail.error.value" @retry="reloadDetail">
          <template v-if="current">
            <Descriptions :column="1" size="small" bordered>
              <DescriptionsItem :label="t('page.teacherHomepage.requests.teacherId')">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <bdi>{{ current.teacher_id }}</bdi>
                  <RouterLink v-if="!locked" class="text-primary underline" :to="{ name: 'TeacherHomepageProfile', query: { teacher_id: current.teacher_id } }">
                    {{ t('page.teacherHomepage.requests.editProfile') }}
                  </RouterLink>
                </div>
              </DescriptionsItem>
              <DescriptionsItem :label="t('page.teacherHomepage.requests.type')">
                {{ t(`page.teacherHomepage.requests.kinds.${current.kind}`) }}
              </DescriptionsItem>
              <DescriptionsItem :label="t('page.teacherHomepage.requests.field')">
                {{ t(`page.teacherHomepage.fields.${current.field.field}`) }}
                <bdi v-if="current.field.label"> · {{ current.field.label }}</bdi>
              </DescriptionsItem>
              <DescriptionsItem :label="t('page.common.status')">
                <Tag :color="stateColor(current.status)">
                  {{ t(`page.teacherHomepage.requests.states.${current.status}`) }}
                </Tag>
              </DescriptionsItem>
              <DescriptionsItem :label="t('page.common.createdAt')">
                {{ format.dateTime(current.created_at) }}
              </DescriptionsItem>
              <DescriptionsItem :label="t('page.teacherHomepage.requests.message')">
                <p class="whitespace-pre-wrap break-words" dir="auto">{{ current.message }}</p>
              </DescriptionsItem>
              <DescriptionsItem v-if="current.value" :label="t('page.teacherHomepage.requests.proposal')">
                <template v-if="current.value.photo">
                  <img
                    v-if="photoUrl"
                    :src="photoUrl"
                    :alt="t('page.teacherHomepage.requests.photo')"
                    class="max-h-80 max-w-full rounded object-contain"
                    @error="photoFailed"
                  />
                  <LoadState
                    v-else-if="photo.status.value === 'error' || brokenPhoto"
                    status="error"
                    :error="brokenPhoto ? 'incompatible' : photo.error.value"
                    @retry="showPhoto"
                  />
                  <Button v-else :loading="photo.status.value === 'loading'" @click="showPhoto">
                    {{ t('page.teacherHomepage.requests.previewPhoto') }}
                  </Button>
                </template>
                <RequestValue v-else :value="current.value" />
              </DescriptionsItem>
              <DescriptionsItem v-if="current.resolved_at" :label="t('page.teacherHomepage.requests.resolvedAt')">
                {{ format.dateTime(current.resolved_at) }}
              </DescriptionsItem>
              <DescriptionsItem v-if="current.resolution_note" :label="t('page.teacherHomepage.requests.note')">
                <p class="whitespace-pre-wrap break-words" dir="auto">{{ current.resolution_note }}</p>
              </DescriptionsItem>
            </Descriptions>

            <Form
              v-if="current.status === 'pending' && access.canMaintain.value"
              layout="vertical"
              @submit.prevent="saveDecision()"
            >
              <FormItem :label="t('page.teacherHomepage.requests.resolve')">
                <RadioGroup
                  v-model:value="action"
                  :aria-label="t('page.teacherHomepage.requests.resolve')"
                  :disabled="locked"
                >
                  <Radio value="approve">{{ t('page.teacherHomepage.requests.actions.approve') }}</Radio>
                  <Radio value="reject">{{ t('page.teacherHomepage.requests.actions.reject') }}</Radio>
                </RadioGroup>
              </FormItem>
              <div v-if="action === 'approve'" class="mb-4">
                <LoadState :status="controls.status.value" :error="controls.error.value" @retry="controls.reload">
                  <p v-if="controls.data.value">
                    {{ t('page.teacherHomepage.requests.homeRevision') }} · {{ format.number(controls.data.value.controls.revision) }}
                  </p>
                </LoadState>
              </div>
              <FormItem
                :label="t('page.teacherHomepage.requests.note')"
                :extra="t('page.teacherHomepage.requests.noteHint')"
                :help="noteTooLong ? t('page.teacherHomepage.requests.noteLimit', { limit: format.number(decisionNoteLimit) }) : undefined"
                :validate-status="noteTooLong ? 'error' : undefined"
                html-for="homepage-request-note"
                required
              >
                <Textarea
                  id="homepage-request-note"
                  v-model:value="note"
                  dir="auto"
                  :auto-size="{ minRows: 3, maxRows: 8 }"
                  :maxlength="decisionNoteLimit * 2"
                  :disabled="locked"
                />
              </FormItem>
              <Button
                type="primary"
                html-type="submit"
                :loading="deciding.busy.value"
                :disabled="locked || !availableDecision"
              >
                {{ t('page.teacherHomepage.requests.submit') }}
              </Button>
            </Form>
          </template>
        </LoadState>
      </div>
    </Drawer>
  </AdminPage>
</template>
