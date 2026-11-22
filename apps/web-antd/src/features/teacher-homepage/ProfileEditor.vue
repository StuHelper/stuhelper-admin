<script setup lang="ts">
import type {
  ProfileDraft,
  ProfileField,
  ProfileRule,
  ProfileSelector,
} from './profileRules';

import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteUpdate } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Input } from 'ant-design-vue';

import { useAsync, useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useTeacherHomepageAccess } from './access';
import { useTeacherHomepageProfile } from './profileApi';
import ProfileRuleEditor from './ProfileRuleEditor.vue';
import {
  draftFromControls,
  isGroupField,
  mergeProfileDraft,
  profileDraftChanged,
  profileFieldKey,
  profileFields,
  profileSelectorKey,
  profileVisibilities,
  validProfileRule,
  validProfileText,
} from './profileRules';
import ProfileSource from './ProfileSource.vue';

const props = defineProps<{ schoolId: string; teacherId: string }>();

const { t } = useI18n();
const access = useTeacherHomepageAccess();
const api = useTeacherHomepageProfile();
const baseline = shallowRef<ProfileDraft>();
const draft = shallowRef<ProfileDraft>();
const recovering = shallowRef<{ before: ProfileDraft; local: ProfileDraft }>();
const saved = ref(false);
const warning = ref('');
const validation = ref('');
const newField = ref<ProfileField>('name');
const newLabel = ref('');
const photoBusy = ref(false);
let disposed = false;

function clearRestricted() {
  baseline.value = undefined;
  draft.value = undefined;
  recovering.value = undefined;
  newLabel.value = '';
  saved.value = false;
  warning.value = '';
  validation.value = '';
  if (!disposed) access.reportMaintain(props.schoolId, false);
}

const profileRead = useAsync(
  (signal) => api.getControls(props.schoolId, props.teacherId, signal),
  { onDenied: clearRestricted },
);
const write = useMutation({
  onDenied: () => {
    profileRead.clear();
    clearRestricted();
  },
});
const changed = computed(() =>
  !!baseline.value && !!draft.value && profileDraftChanged(baseline.value, draft.value),
);
const dirty = computed(() => changed.value || !!newLabel.value);
const writeLocked = computed(() => write.busy.value || write.uncertain.value);
const editable = computed(() => access.canMaintain.value && !writeLocked.value);

function leaveMessage() {
  if (write.uncertain.value) return t('page.common.leaveUncertain');
  return dirty.value || write.busy.value || photoBusy.value
    ? t('page.common.leaveUnsaved')
    : '';
}

useLeaveGuard(leaveMessage);
onBeforeRouteUpdate((to, from) => {
  // The profile identity can change in the query without leaving the route.
  if (to.path !== from.path || to.query.teacher_id === from.query.teacher_id) return true;
  const question = leaveMessage();
  return !question || window.confirm(question);
});
onScopeDispose(() => {
  disposed = true;
});
onMounted(() => void profileRead.reload());

watch(profileRead.data, (value) => {
  if (!value || disposed) return;
  access.reportMaintain(props.schoolId, true);
  const current = draftFromControls(value.controls);
  const retry = recovering.value;
  baseline.value = current;
  if (retry) {
    const merged = mergeProfileDraft(retry.before, retry.local, current);
    recovering.value = undefined;
    warning.value = merged.overlapping ? 'conflictOverlapping' : 'conflict';
    draft.value = merged.draft;
  } else {
    draft.value = current;
  }
});

function updateDraft(update: Partial<ProfileDraft>) {
  if (!draft.value || !editable.value) return;
  draft.value = { ...draft.value, ...update };
  write.dismiss();
  saved.value = false;
  validation.value = '';
}

function changeVisibility(event: Event) {
  const element = event.target;
  if (!(element instanceof HTMLSelectElement)) return;
  const value = profileVisibilities.find((item) => item === element.value);
  if (value) updateDraft({ page_visibility: value });
}

function replaceRules(rules: ProfileRule[]) {
  updateDraft({ rules });
}

function changeRule(index: number, change: ProfileRule) {
  if (!draft.value) return;
  replaceRules(draft.value.rules.map((rule, position) => position === index ? change : rule));
}

function removeRule(index: number) {
  if (!draft.value) return;
  replaceRules(draft.value.rules.filter((_, position) => position !== index));
}

function addRule() {
  if (!draft.value || !editable.value) return;
  if (draft.value.rules.length >= 256) {
    validation.value = 'tooManyRules';
    return;
  }
  const label = newLabel.value.trim();
  const field: ProfileSelector = { field: newField.value };
  if (label && isGroupField(field.field)) {
    if (!validProfileText(label, 160)) {
      validation.value = 'invalidRule';
      return;
    }
    field.label = label;
  }
  if (draft.value.rules.some((rule) => profileSelectorKey(rule.field) === profileSelectorKey(field))) {
    validation.value = 'duplicate';
    return;
  }
  replaceRules([...draft.value.rules, { field, hidden: true }]);
  newLabel.value = '';
}

function canPreviewRule(rule: ProfileRule) {
  return (
    draft.value?.page_visibility === 'visible' &&
    !rule.hidden &&
    baseline.value?.page_visibility === 'visible' &&
    baseline.value.rules.some(({ field, hidden }) => field.field === 'photo' && !hidden)
  );
}

async function finishWrite(result: unknown) {
  if (disposed) return;
  if (result) {
    saved.value = true;
    warning.value = '';
    draft.value = undefined;
    baseline.value = undefined;
    await profileRead.reload();
  } else if (write.error.value === 'conflict' && baseline.value && draft.value) {
    recovering.value = { before: baseline.value, local: draft.value };
    write.dismiss();
    await profileRead.reload();
  }
}

async function save() {
  const body = draft.value;
  if (!body || !editable.value || photoBusy.value || !changed.value) return;
  if (body.rules.length > 256) {
    validation.value = 'tooManyRules';
    return;
  }
  if (!body.rules.every(validProfileRule)) {
    validation.value = 'invalidRule';
    return;
  }
  const school = props.schoolId;
  const teacher = props.teacherId;
  validation.value = '';
  saved.value = false;
  warning.value = '';
  await finishWrite(
    await write.run(teacher, body, (input, key) => api.setControls(school, teacher, input, key)),
  );
}

async function retryWrite() {
  await finishWrite(await write.retry());
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <MutationAlert
      :busy="write.busy.value"
      :error="write.error.value"
      :success="saved ? t('page.teacherHomepage.profile.saved') : ''"
      :uncertain="write.uncertain.value"
      @retry="retryWrite"
    />
    <LoadState
      :error="profileRead.error.value"
      :status="profileRead.status.value"
      @retry="profileRead.reload"
    >
      <template v-if="draft">
        <div class="flex flex-col gap-4">
          <Alert
            v-if="warning"
            role="status"
            show-icon
            type="warning"
            :message="t(`page.teacherHomepage.profile.${warning}`)"
          />
          <Card :bordered="false">
            <div class="flex flex-col items-start gap-2">
              <label for="teacher-homepage-visibility" class="font-medium">
                {{ t('page.teacherHomepage.profile.visibility') }}
              </label>
              <select
                id="teacher-homepage-visibility"
                aria-describedby="teacher-homepage-visibility-help"
                class="min-h-8 max-w-full rounded-md border bg-background p-1"
                :value="draft.page_visibility"
                :disabled="!editable"
                @change="changeVisibility"
              >
                <option v-for="visibility in profileVisibilities" :key="visibility" :value="visibility">
                  {{ t(`page.teacherHomepage.profile.${visibility}`) }}
                </option>
              </select>
              <p id="teacher-homepage-visibility-help" class="text-muted-foreground">
                {{ t('page.teacherHomepage.profile.visibilityHelp') }}
              </p>
              <p v-if="profileRead.data.value?.controls.independent">
                {{ t('page.teacherHomepage.profile.independent') }}
              </p>
            </div>
          </Card>
          <Card :bordered="false" :title="t('page.teacherHomepage.profile.rules')">
            <div class="flex flex-col gap-4">
              <p v-if="draft.rules.length === 0" class="text-muted-foreground">
                {{ t('page.teacherHomepage.profile.noRules') }}
              </p>
              <ProfileRuleEditor
                v-for="(rule, index) in draft.rules"
                :key="profileSelectorKey(rule.field)"
                :disabled="!editable"
                :index="index"
                :rule="rule"
                :saved-photo-preview="canPreviewRule(rule)"
                :teacher-id="teacherId"
                @change="changeRule(index, $event)"
                @photo-busy="photoBusy = $event"
                @remove="removeRule(index)"
              />
              <div v-if="access.canMaintain.value" class="flex flex-wrap items-end gap-3">
                <div class="flex flex-col gap-1">
                  <label for="teacher-homepage-field">
                    {{ t('page.teacherHomepage.profile.fieldLabel') }}
                  </label>
                  <select
                    id="teacher-homepage-field"
                    v-model="newField"
                    class="min-h-8 max-w-full rounded-md border bg-background p-1"
                    :disabled="!editable"
                    @change="newLabel = ''"
                  >
                    <option v-for="field in profileFields" :key="field" :value="field">
                      {{ t(profileFieldKey(field)) }}
                    </option>
                  </select>
                </div>
                <div v-if="isGroupField(newField)" class="flex flex-col gap-1">
                  <label for="teacher-homepage-label">
                    {{ t('page.teacherHomepage.profile.selectorLabel') }}
                  </label>
                  <Input
                    id="teacher-homepage-label"
                    v-model:value="newLabel"
                    :disabled="!editable"
                    :placeholder="t('page.teacherHomepage.profile.selectorPlaceholder')"
                    @press-enter="addRule"
                  />
                </div>
                <Button
                  data-testid="teacher-homepage-add-rule"
                  :disabled="!editable"
                  @click="addRule"
                >
                  {{ t('page.teacherHomepage.profile.addRule') }}
                </Button>
              </div>
              <Alert
                v-if="validation"
                role="alert"
                show-icon
                type="error"
                :message="t(`page.teacherHomepage.profile.${validation}`)"
              />
              <Button
                v-if="access.canMaintain.value"
                data-testid="teacher-homepage-save-profile"
                type="primary"
                class="self-start"
                :disabled="!editable || photoBusy || !changed"
                :loading="write.busy.value"
                @click="save"
              >
                {{ t('page.common.save') }}
              </Button>
            </div>
          </Card>
          <ProfileSource :source="profileRead.data.value?.source" />
        </div>
      </template>
    </LoadState>
  </div>
</template>
