<script setup lang="ts">
import type {
  ReviewSite,
  ReviewTeacherSummary,
  SiteDecisionInput,
  SiteReviewQuery,
  TeacherReviewQuery,
} from './matchingApi';

import { computed, nextTick, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Input,
  Popconfirm,
  Select,
  Tag,
} from 'ant-design-vue';

import { useAsync, useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useTeacherMatchingApi } from './matchingApi';

const props = defineProps<{ mayWrite: boolean; school: string }>();
const emit = defineEmits<{
  read: [school: string, allowed: boolean];
  writeDenied: [school: string];
}>();
const { t, te } = useI18n();
const format = useFormat();
const api = useTeacherMatchingApi();

const siteSearch = ref('');
const teacherSearch = ref('');
const siteQuery = ref('');
const teacherQuery = ref('');
const siteStatus = ref<NonNullable<SiteReviewQuery['status']>>('pending');
const teacherStatus =
  ref<NonNullable<TeacherReviewQuery['status']>>('unmatched');
const siteTotal = ref(0);
const teacherTotal = ref(0);
const siteNotice = ref(false);
const teacherNotice = ref(false);
const readError = ref('');

const selectedSite = shallowRef<ReviewSite>();
const selectedTeacher = shallowRef<ReviewTeacherSummary>();
const siteLookupId = ref('');
const details = ref<HTMLElement>();
let detailsTrigger: HTMLElement | undefined;

const decisionFeedback = ref<'' | 'conflict' | 'saved'>('');
const reloadingDecision = ref(false);
const writeDenied = ref(false);
// Keep the retry target even if a separate read loses access and clears the
// details. The existing mutation still has the original request body and key.
let pendingSiteId = '';
let active = true;
onScopeDispose(() => {
  active = false;
});
const mutation = useMutation({
  onDenied: () => {
    if (!active) return;
    writeDenied.value = true;
    selectedTeacher.value = undefined;
    emit('writeDenied', props.school);
  },
});
const canWrite = computed(() => props.mayWrite && !writeDenied.value);
const locked = computed(
  () => mutation.busy.value || mutation.uncertain.value || reloadingDecision.value,
);
const siteSide = usePaged(
  async (after, signal) => {
    const page = await api.sites(
      props.school,
      { after, limit: 20, q: siteQuery.value, status: siteStatus.value },
      signal,
    );
    if (!signal.aborted) {
      siteTotal.value = page.total;
      emit('read', props.school, true);
    }
    return page;
  },
  { onDenied: (cause) => denyRead(cause.code, 'site') },
);
const teacherSide = usePaged(
  async (after, signal) => {
    const page = await api.teachers(
      props.school,
      { after, limit: 20, q: teacherQuery.value, status: teacherStatus.value },
      signal,
    );
    if (!signal.aborted) {
      teacherTotal.value = page.total;
      emit('read', props.school, true);
    }
    return page;
  },
  { onDenied: (cause) => denyRead(cause.code, 'teacher') },
);
const currentSite = useAsync(
  (signal) => api.site(props.school, siteLookupId.value, signal),
  { onDenied: (cause) => denyRead(cause.code, 'details') },
);
const activeSite = computed(() => selectedSite.value ?? currentSite.data.value);

const siteStatuses = computed(() => [
  { value: 'pending', label: t('page.teacherHomepage.match.pending') },
  { value: 'decided', label: t('page.teacherHomepage.match.decided') },
  { value: 'all', label: t('page.common.all') },
]);
const teacherStatuses = computed(() => [
  { value: 'unmatched', label: t('page.teacherHomepage.match.unmatched') },
  { value: 'all', label: t('page.common.all') },
]);

function denyRead(code: string, side: 'details' | 'site' | 'teacher') {
  readError.value = code;
  if (side !== 'site') siteSide.clear();
  if (side !== 'teacher') teacherSide.clear();
  clearSite();
  selectedTeacher.value = undefined;
  emit('read', props.school, false);
}

function reloadSites() {
  siteNotice.value = false;
  return siteSide.reload();
}

function reloadTeachers() {
  teacherNotice.value = false;
  return teacherSide.reload();
}

function retryRead() {
  readError.value = '';
  return Promise.all([reloadSites(), reloadTeachers()]);
}

watch([siteQuery, siteStatus], reloadSites, { immediate: true });
watch([teacherQuery, teacherStatus], reloadTeachers, { immediate: true });

async function loadMore(side: 'site' | 'teacher') {
  const list = side === 'site' ? siteSide : teacherSide;
  const notice = side === 'site' ? siteNotice : teacherNotice;
  notice.value = false;
  await list.loadMore();
  if (list.error.value === 'conflict') {
    // A changed snapshot or decision invalidates the cursor for this filter.
    await list.reload();
    notice.value = list.status.value === 'ready';
  }
}

function retrySide(side: 'site' | 'teacher') {
  const list = side === 'site' ? siteSide : teacherSide;
  if (list.next.value) return loadMore(side);
  return list.reload();
}

function clearSite() {
  selectedSite.value = undefined;
  siteLookupId.value = '';
  currentSite.clear();
}

async function reviewSite(row: ReviewSite, event: MouseEvent) {
  if (locked.value) return;
  detailsTrigger = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : undefined;
  mutation.dismiss();
  decisionFeedback.value = '';
  clearSite();
  selectedSite.value = row;
  await nextTick();
  details.value?.focus();
}

async function locateSite(id: string, event: MouseEvent) {
  if (locked.value) return;
  detailsTrigger = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : undefined;
  mutation.dismiss();
  decisionFeedback.value = '';
  // Start the lookup before moving focus so the details are present in the DOM.
  const load = resolveSite(id);
  await nextTick();
  details.value?.focus();
  await load;
}

function resolveSite(id: string) {
  selectedSite.value = undefined;
  siteLookupId.value = id;
  return currentSite.reload();
}

function closeSite() {
  if (locked.value) return;
  if (activeSite.value && selectedTeacher.value && !window.confirm(t('page.common.leaveUnsaved'))) return;
  clearSite();
  selectedTeacher.value = undefined;
  decisionFeedback.value = '';
  mutation.dismiss();
  detailsTrigger?.focus();
}

function selectTeacher(teacher: ReviewTeacherSummary) {
  if (!canWrite.value || locked.value) return;
  selectedTeacher.value = teacher;
}

function reasonText(reason: string) {
  const existing = `page.teacherSites.reasons.${reason}`;
  const matching = `page.teacherHomepage.match.reason.${reason}`;
  if (te(existing)) return t(existing);
  if (te(matching)) return t(matching);
  return t('page.common.notProvided');
}

function confirmText(action: SiteDecisionInput['action']) {
  return t(`page.teacherHomepage.match.confirm.${action}`, {
    site: activeSite.value?.name ?? '',
    ...(action === 'bind' ? { teacher: selectedTeacher.value?.name ?? '' } : {}),
  });
}

async function decide(action: SiteDecisionInput['action']) {
  const site = activeSite.value;
  const teacher = selectedTeacher.value;
  if (locked.value || !canWrite.value || !site) return;
  if (action === 'bind' && (!site.present || !teacher)) return;
  if (action === 'revoke' && !site.decision) return;

  decisionFeedback.value = '';
  const body: SiteDecisionInput = {
    action,
    expected_revision: site.decision_revision,
    ...(action === 'bind' && teacher ? { teacher_id: teacher.teacher_id } : {}),
  };
  pendingSiteId = site.site_id;
  const result = await mutation.run(site.site_id, body, (value, key) =>
    api.decide(props.school, site.site_id, value, key),
  );
  await finishDecision(result !== undefined);
}

async function retryDecision() {
  if (!pendingSiteId || !mutation.uncertain.value || mutation.busy.value) return;
  const result = await mutation.retry();
  await finishDecision(result !== undefined);
}

async function finishDecision(saved: boolean) {
  if (!active || mutation.uncertain.value) return;
  const id = pendingSiteId;
  pendingSiteId = '';
  const conflict = mutation.error.value === 'conflict';
  if ((!saved && !conflict) || readError.value) return;

  reloadingDecision.value = true;
  mutation.dismiss();
  if (saved) {
    selectedTeacher.value = undefined;
    decisionFeedback.value = 'saved';
  }
  try {
    await Promise.all([resolveSite(id), reloadSites(), reloadTeachers()]);
    if (conflict && !readError.value) decisionFeedback.value = 'conflict';
  } finally {
    reloadingDecision.value = false;
  }
}

useLeaveGuard(() => {
  if (mutation.uncertain.value || mutation.busy.value)
    return t('page.common.leaveUncertain');
  return canWrite.value && selectedTeacher.value
    ? t('page.common.leaveUnsaved')
    : '';
});
</script>

<template>
  <MutationAlert
    v-if="mutation.uncertain.value && !activeSite"
    :busy="mutation.busy.value"
    :error="mutation.error.value"
    :uncertain="mutation.uncertain.value"
    class="mb-3"
    @retry="retryDecision()"
  />
  <LoadState
    v-if="readError"
    status="error"
    :error="readError"
    @retry="retryRead()"
  />

  <div v-else class="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
    <section :aria-label="t('page.teacherHomepage.match.sites')" class="min-w-0">
      <Card :title="t('page.teacherHomepage.match.sites')" :bordered="false">
        <div class="flex flex-wrap gap-3">
          <form class="flex min-w-0 flex-1 gap-2" @submit.prevent="siteQuery = siteSearch.trim()">
            <Input
              v-model:value="siteSearch"
              :maxlength="200"
              :aria-label="t('page.teacherHomepage.match.searchSites')"
              :placeholder="t('page.teacherHomepage.match.searchSites')"
            />
            <Button html-type="submit">{{ t('page.common.search') }}</Button>
          </form>
          <Select
            v-model:value="siteStatus"
            class="min-w-36"
            :aria-label="t('page.teacherHomepage.match.siteStatus')"
            :options="siteStatuses"
          />
        </div>

        <section
          v-if="activeSite || siteLookupId"
          ref="details"
          :aria-label="t('page.teacherHomepage.match.reviewTitle')"
          class="my-4 grid min-w-0 gap-3 rounded-md border p-3"
          tabindex="-1"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="m-0 text-base font-semibold">
              {{ t('page.teacherHomepage.match.reviewTitle') }}
            </h3>
            <Button :disabled="locked" @click="closeSite()">
              {{ t('page.common.cancel') }}
            </Button>
          </div>
          <MutationAlert
            :busy="mutation.busy.value"
            :error="mutation.error.value"
            :success="decisionFeedback === 'saved' ? t('page.common.saved') : ''"
            :uncertain="mutation.uncertain.value"
            @retry="retryDecision()"
          />
          <Alert
            v-if="decisionFeedback === 'conflict' && currentSite.status.value === 'ready'"
            type="warning"
            show-icon
            role="status"
            :message="t('page.teacherHomepage.match.conflictReloaded')"
          />
          <LoadState
            v-if="siteLookupId && !activeSite"
            :status="currentSite.status.value"
            :error="currentSite.error.value"
            empty
            :empty-text="t('page.teacherHomepage.match.siteNotFound')"
            @retry="resolveSite(siteLookupId)"
          />
          <template v-if="activeSite">
            <Descriptions bordered size="small" :column="1">
              <DescriptionsItem :label="t('page.teacherSites.name')">
                <bdi>{{ activeSite.name }}</bdi>
              </DescriptionsItem>
              <DescriptionsItem :label="t('page.teacherSites.unit')">
                <bdi>{{ activeSite.unit || t('page.common.notProvided') }}</bdi>
              </DescriptionsItem>
              <DescriptionsItem :label="t('page.teacherHomepage.match.siteId')">
                <bdi class="break-all">{{ activeSite.site_id }}</bdi>
              </DescriptionsItem>
              <DescriptionsItem v-if="activeSite.reason" :label="t('page.teacherSites.reason')">
                {{ reasonText(activeSite.reason) }}
              </DescriptionsItem>
              <DescriptionsItem
                v-if="activeSite.discipline"
                :label="t('page.teacherHomepage.match.discipline')"
              >
                <bdi>{{ activeSite.discipline }}</bdi>
              </DescriptionsItem>
              <DescriptionsItem
                v-if="activeSite.biography_excerpt"
                :label="t('page.teacherHomepage.match.biography')"
              >
                <span class="break-words" dir="auto">{{ activeSite.biography_excerpt }}</span>
              </DescriptionsItem>
              <DescriptionsItem :label="t('page.teacherHomepage.match.currentDecision')">
                <Tag>{{ t(`page.teacherHomepage.match.decision.${activeSite.decision?.action ?? 'none'}`) }}</Tag>
              </DescriptionsItem>
              <DescriptionsItem
                v-if="activeSite.decision?.teacher_id"
                :label="t('page.teacherHomepage.match.bindingTarget')"
              >
                <bdi class="break-all">{{ activeSite.decision.teacher_id }}</bdi>
              </DescriptionsItem>
              <DescriptionsItem
                v-if="activeSite.matched_teacher_id"
                :label="t('page.teacherHomepage.match.matchedTeacher')"
              >
                <bdi class="break-all">{{ activeSite.matched_teacher_id }}</bdi>
              </DescriptionsItem>
            </Descriptions>
            <Alert
              v-if="!activeSite.present"
              type="info"
              show-icon
              :message="t('page.teacherHomepage.match.siteMissing')"
            />
            <div>
              <h4 class="m-0 text-sm font-semibold">
                {{ t('page.teacherHomepage.match.teacherCandidates') }}
              </h4>
              <p v-if="activeSite.candidate_count > activeSite.candidates.length" class="my-2 text-sm opacity-70">
                {{ t('page.teacherHomepage.match.candidateLimit', {
                  shown: format.number(activeSite.candidates.length),
                  total: format.number(activeSite.candidate_count),
                }) }}
              </p>
              <p v-if="activeSite.candidates.length === 0" class="my-2 text-sm opacity-70">
                {{ t('page.common.empty') }}
              </p>
              <ul v-else class="m-0 divide-y p-0">
                <li
                  v-for="teacher in activeSite.candidates"
                  :key="teacher.teacher_id"
                  class="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span class="min-w-0 break-words">
                    <bdi class="font-medium">{{ teacher.name }}</bdi>
                    <bdi v-if="teacher.department || teacher.department_id" class="block text-sm">
                      {{ teacher.department || teacher.department_id }}
                    </bdi>
                    <bdi v-if="teacher.title" class="block text-sm">{{ teacher.title }}</bdi>
                    <bdi class="block break-all text-xs opacity-70">{{ teacher.teacher_id }}</bdi>
                  </span>
                  <Button
                    v-if="canWrite"
                    :disabled="locked"
                    :aria-pressed="selectedTeacher?.teacher_id === teacher.teacher_id"
                    @click="selectTeacher(teacher)"
                  >
                    {{ t('page.teacherHomepage.match.chooseTeacher') }}
                  </Button>
                </li>
              </ul>
            </div>
            <div v-if="canWrite" class="grid gap-2">
              <div v-if="selectedTeacher" class="flex flex-wrap items-center gap-2">
                <p class="m-0">
                  {{ t('page.teacherHomepage.match.selectedTeacher') }}
                  <bdi class="font-semibold">{{ selectedTeacher.name }}</bdi>
                  <bdi class="break-all text-xs opacity-70">{{ selectedTeacher.teacher_id }}</bdi>
                </p>
                <Button :disabled="locked" @click="selectedTeacher = undefined">
                  {{ t('page.teacherHomepage.match.clearTeacher') }}
                </Button>
              </div>
              <div class="flex flex-wrap gap-2">
                <Popconfirm
                  :title="confirmText('bind')"
                  :ok-text="t('page.common.confirm')"
                  :cancel-text="t('page.common.cancel')"
                  :disabled="locked || !activeSite.present || !selectedTeacher"
                  @confirm="decide('bind')"
                >
                  <Button type="primary" :disabled="locked || !activeSite.present || !selectedTeacher">
                    {{ t('page.teacherHomepage.match.action.bind') }}
                  </Button>
                </Popconfirm>
                <Popconfirm
                  v-if="activeSite.decision?.action !== 'reject' && (activeSite.present || !activeSite.decision)"
                  :title="confirmText('reject')"
                  :ok-text="t('page.common.confirm')"
                  :cancel-text="t('page.common.cancel')"
                  :disabled="locked"
                  @confirm="decide('reject')"
                >
                  <Button :disabled="locked">{{ t('page.teacherHomepage.match.action.reject') }}</Button>
                </Popconfirm>
                <Popconfirm
                  v-if="activeSite.decision"
                  :title="confirmText('revoke')"
                  :ok-text="t('page.common.confirm')"
                  :cancel-text="t('page.common.cancel')"
                  :disabled="locked"
                  @confirm="decide('revoke')"
                >
                  <Button :disabled="locked">{{ t('page.teacherHomepage.match.action.revoke') }}</Button>
                </Popconfirm>
              </div>
            </div>
          </template>
        </section>

        <Alert
          v-if="siteNotice"
          class="mt-3"
          type="info"
          show-icon
          role="status"
          :message="t('page.teacherHomepage.match.cursorConflict')"
        />
        <LoadState
          v-if="siteSide.status.value !== 'loading' || !siteSide.appending.value"
          class="mt-3"
          :status="siteSide.status.value"
          :error="siteSide.error.value"
          :empty="siteSide.items.value.length === 0"
          @retry="retrySide('site')"
        />
        <template v-if="siteSide.items.value.length > 0">
          <p class="mb-1 mt-3 text-sm opacity-70">
            {{ t('page.teacherHomepage.match.total', { count: format.number(siteTotal) }) }}
          </p>
          <ul class="m-0 divide-y p-0">
            <li
              v-for="site in siteSide.items.value"
              :key="site.site_id"
              class="flex flex-wrap items-start justify-between gap-2 py-3"
            >
              <div class="min-w-0 break-words">
                <bdi class="font-semibold">{{ site.name }}</bdi>
                <bdi v-if="site.unit" class="block text-sm">{{ site.unit }}</bdi>
                <p v-if="site.decision || site.reason" class="m-0 text-sm opacity-70">
                  {{ site.decision
                    ? t(`page.teacherHomepage.match.decision.${site.decision.action}`)
                    : reasonText(site.reason ?? '') }}
                </p>
              </div>
              <Button
                :disabled="locked"
                :aria-pressed="activeSite?.site_id === site.site_id"
                @click="reviewSite(site, $event)"
              >
                {{ t('page.teacherHomepage.match.reviewSite') }}
              </Button>
            </li>
          </ul>
        </template>
        <Button
          v-if="siteSide.next.value && siteSide.status.value !== 'error'"
          :loading="siteSide.appending.value"
          @click="loadMore('site')"
        >
          {{ t('page.common.loadMore') }}
        </Button>
      </Card>
    </section>

    <section :aria-label="t('page.teacherHomepage.match.teachers')" class="min-w-0">
      <Card :title="t('page.teacherHomepage.match.teachers')" :bordered="false">
        <div class="flex flex-wrap gap-3">
          <form class="flex min-w-0 flex-1 gap-2" @submit.prevent="teacherQuery = teacherSearch.trim()">
            <Input
              v-model:value="teacherSearch"
              :maxlength="200"
              :aria-label="t('page.teacherHomepage.match.searchTeachers')"
              :placeholder="t('page.teacherHomepage.match.searchTeachers')"
            />
            <Button html-type="submit">{{ t('page.common.search') }}</Button>
          </form>
          <Select
            v-model:value="teacherStatus"
            class="min-w-36"
            :aria-label="t('page.teacherHomepage.match.teacherStatus')"
            :options="teacherStatuses"
          />
        </div>
        <Alert
          v-if="teacherNotice"
          class="mt-3"
          type="info"
          show-icon
          role="status"
          :message="t('page.teacherHomepage.match.cursorConflict')"
        />
        <LoadState
          v-if="teacherSide.status.value !== 'loading' || !teacherSide.appending.value"
          class="mt-3"
          :status="teacherSide.status.value"
          :error="teacherSide.error.value"
          :empty="teacherSide.items.value.length === 0"
          @retry="retrySide('teacher')"
        />
        <template v-if="teacherSide.items.value.length > 0">
          <p class="mb-1 mt-3 text-sm opacity-70">
            {{ t('page.teacherHomepage.match.total', { count: format.number(teacherTotal) }) }}
          </p>
          <ul class="m-0 divide-y p-0">
            <li
              v-for="teacher in teacherSide.items.value"
              :key="teacher.teacher_id"
              class="grid gap-2 py-3"
            >
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0 break-words">
                  <bdi class="font-semibold">{{ teacher.name }}</bdi>
                  <bdi v-if="teacher.department || teacher.department_id" class="block text-sm">
                    {{ teacher.department || teacher.department_id }}
                  </bdi>
                  <bdi v-if="teacher.title" class="block text-sm">{{ teacher.title }}</bdi>
                  <bdi class="block break-all text-xs opacity-70">{{ teacher.teacher_id }}</bdi>
                  <p v-if="teacher.reason" class="m-0 text-sm opacity-70">
                    {{ reasonText(teacher.reason) }}
                  </p>
                </div>
                <div v-if="canWrite" class="flex flex-wrap items-center gap-2">
                  <Button
                    :disabled="locked"
                    :aria-pressed="selectedTeacher?.teacher_id === teacher.teacher_id"
                    @click="selectTeacher(teacher)"
                  >
                    {{ t('page.teacherHomepage.match.chooseTeacher') }}
                  </Button>
                  <RouterLink
                    :to="{ name: 'TeacherHomepageProfile', query: { teacher_id: teacher.teacher_id } }"
                  >
                    {{ t('page.teacherHomepage.match.profile') }}
                  </RouterLink>
                </div>
              </div>
              <Button
                v-if="teacher.matched_site_id"
                class="justify-self-start"
                :disabled="locked"
                @click="locateSite(teacher.matched_site_id, $event)"
              >
                {{ t('page.teacherHomepage.match.matchedSite') }}
              </Button>
              <details v-if="teacher.candidate_count || teacher.candidates.length > 0">
                <summary class="cursor-pointer">
                  {{ t('page.teacherHomepage.match.checkCandidates', { count: format.number(teacher.candidate_count) }) }}
                </summary>
                <p v-if="teacher.candidate_count > teacher.candidates.length" class="mb-0 mt-2 text-sm opacity-70">
                  {{ t('page.teacherHomepage.match.candidateLimit', {
                    shown: format.number(teacher.candidates.length),
                    total: format.number(teacher.candidate_count),
                  }) }}
                </p>
                <ul :aria-label="t('page.teacherHomepage.match.siteCandidates')" class="my-0 divide-y ps-4">
                  <li
                    v-for="site in teacher.candidates"
                    :key="site.site_id"
                    class="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span class="min-w-0 break-words">
                      <bdi class="font-medium">{{ site.name }}</bdi>
                      <bdi v-if="site.unit" class="block text-sm">{{ site.unit }}</bdi>
                      <span v-if="!site.present" class="block text-sm opacity-70">
                        {{ t('page.teacherHomepage.match.siteMissing') }}
                      </span>
                    </span>
                    <Button :disabled="locked" @click="locateSite(site.site_id, $event)">
                      {{ t('page.teacherHomepage.match.locateSite') }}
                    </Button>
                  </li>
                </ul>
              </details>
            </li>
          </ul>
        </template>
        <Button
          v-if="teacherSide.next.value && teacherSide.status.value !== 'error'"
          :loading="teacherSide.appending.value"
          @click="loadMore('teacher')"
        >
          {{ t('page.common.loadMore') }}
        </Button>
      </Card>
    </section>
  </div>
</template>
