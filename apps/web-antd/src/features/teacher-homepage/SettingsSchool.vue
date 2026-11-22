<script setup lang="ts">
import type { Allowlist, AllowlistField, HomepageCounts } from './settingsApi';
import type { DynamicField } from './settingsFields';

import type { ApiError } from '#/shared/api/errors';

import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import { X as CloseIcon } from '@vben/icons';
import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  FormItem,
  Input,
  RadioButton,
  RadioGroup,
  Statistic,
} from 'ant-design-vue';

import { useAsync, useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import LoadState from '#/shared/ui/LoadState.vue';
import { useErrorText } from '#/shared/ui/messages';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useTeacherHomepageAccess } from './access';
import { useSettingsApi } from './settingsApi';
import {
  allowlistLimit,
  dynamicFields,
  fieldKey,
  labelLimit,
  rebaseAllowlist,
  sameAllowlist,
  standardFields,
} from './settingsFields';

const props = defineProps<{ school: string }>();
const { t } = useI18n();
const format = useFormat();
const errorText = useErrorText();
const access = useTeacherHomepageAccess();
const canMaintain = access.canMaintain;
const api = useSettingsApi();
const countKeys = [
  'eligible',
  'teaching',
  'official',
  'both',
  'verified_homepage',
] as const satisfies readonly (keyof HomepageCounts)[];

const baseline = shallowRef<Allowlist>();
const fields = shallowRef<AllowlistField[]>([]);
const kind = ref<DynamicField>('fields');
const label = ref('');
const labelError = ref<'' | 'duplicate' | 'invalidLabel' | 'limit'>('');
const denied = ref('');
const needsRebase = ref(false);
const rebased = ref(false);
const saved = ref(false);

const selected = computed(() => new Set(fields.value.map((field) => fieldKey(field))));
const chosen = computed(() => fields.value.filter((field) => field.field === kind.value));
const dirty = computed(
  () => !!baseline.value && !sameAllowlist(baseline.value.fields, fields.value),
);
const atLimit = computed(() => fields.value.length >= allowlistLimit);
let active = true;
onScopeDispose(() => {
  active = false;
});

const allowlist = useAsync(
  (signal) => api.readAllowlist(props.school, signal),
  { onDenied },
);
const counts = useAsync(
  (signal) => api.readCounts(props.school, signal),
  { onDenied },
);
const save = useMutation({ onDenied });
const countRows = computed(() => {
  const values = counts.data.value;
  return values ? countKeys.map((key) => ({ key, value: values[key] })) : [];
});
const locked = computed(() => save.busy.value || save.uncertain.value);
const disabled = computed(() => !canMaintain.value || locked.value || needsRebase.value);

function resetEditor() {
  baseline.value = undefined;
  fields.value = [];
  label.value = '';
  labelError.value = '';
  needsRebase.value = false;
  rebased.value = false;
}

function onDenied(error: ApiError) {
  if (!active) return;
  denied.value = error.code;
  access.reportMaintain(props.school, false);
  allowlist.clear();
  counts.clear();
  resetEditor();
  saved.value = false;
}

async function readAllowlist() {
  if (allowlist.status.value === 'loading') return;
  await allowlist.reload();
  const latest = allowlist.data.value;
  if (!latest || denied.value || !active) return;
  access.reportMaintain(props.school, true);
  if (needsRebase.value && baseline.value) {
    fields.value = rebaseAllowlist(
      baseline.value.fields,
      fields.value,
      latest.fields,
    );
    rebased.value = true;
    save.dismiss();
  } else {
    fields.value = latest.fields;
  }
  baseline.value = latest;
  needsRebase.value = false;
}

async function readCounts() {
  if (counts.status.value === 'loading') return;
  await counts.reload();
  if (counts.data.value && !denied.value && active) {
    access.reportMaintain(props.school, true);
  }
}

function retryReads() {
  denied.value = '';
  save.dismiss();
  void readAllowlist();
  void readCounts();
}
retryReads();

watch([kind, label], () => {
  labelError.value = '';
});

useLeaveGuard(() => {
  if (save.uncertain.value) return t('page.common.leaveUncertain');
  return dirty.value || locked.value || label.value.trim()
    ? t('page.common.leaveUnsaved')
    : '';
});

function remove(field: AllowlistField) {
  if (disabled.value) return;
  const key = fieldKey(field);
  fields.value = fields.value.filter((entry) => fieldKey(entry) !== key);
  saved.value = false;
  save.dismiss();
}

function toggleStandard(field: (typeof standardFields)[number]) {
  if (disabled.value) return;
  const selector = { field };
  if (selected.value.has(fieldKey(selector))) {
    remove(selector);
  } else if (!atLimit.value) {
    fields.value = [...fields.value, selector];
    saved.value = false;
    save.dismiss();
  }
}

function addLabel() {
  if (disabled.value) return;
  const item = { field: kind.value, label: label.value.trim() };
  const key = fieldKey(item);
  if (key === `${kind.value}:` || [...item.label].length > labelLimit) {
    labelError.value = 'invalidLabel';
  } else if (selected.value.has(key)) {
    labelError.value = 'duplicate';
  } else if (atLimit.value) {
    labelError.value = 'limit';
  } else {
    fields.value = [...fields.value, item];
    label.value = '';
    saved.value = false;
    save.dismiss();
  }
}

function discard() {
  if (!baseline.value || disabled.value) return;
  fields.value = baseline.value.fields;
  label.value = '';
  labelError.value = '';
  rebased.value = false;
  saved.value = false;
  save.dismiss();
}

async function settleSave(result: unknown) {
  if (!active || denied.value) return;
  if (result) {
    resetEditor();
    saved.value = true;
    await readAllowlist();
  } else if (save.error.value === 'conflict') {
    needsRebase.value = true;
    rebased.value = false;
    await readAllowlist();
  }
}

async function submit() {
  if (
    !baseline.value ||
    !dirty.value ||
    disabled.value ||
    fields.value.length > allowlistLimit
  ) {
    return;
  }
  saved.value = false;
  rebased.value = false;
  const body = {
    expected_revision: baseline.value.revision,
    fields: fields.value,
  };
  const target = props.school;
  await settleSave(
    await save.run(`homepage-allowlist:${target}`, body, (value, key) =>
      api.saveAllowlist(target, value, key),
    ),
  );
}

async function retrySave() {
  if (!canMaintain.value || denied.value || !save.uncertain.value) return;
  await settleSave(await save.retry());
}
</script>

<template>
  <Alert
    v-if="denied"
    role="alert"
    type="error"
    show-icon
    :message="errorText(denied)"
  >
    <template #action>
      <Button size="small" @click="retryReads">{{ t('page.common.retry') }}</Button>
    </template>
  </Alert>
  <div v-else class="flex flex-col gap-4">
    <Card :bordered="false" :title="t('page.teacherHomepage.settings.counts')">
      <LoadState
        :status="counts.status.value"
        :error="counts.error.value"
        @retry="readCounts"
      >
        <template v-if="countRows.length > 0">
          <p class="mb-4 text-sm text-muted-foreground">
            {{ t('page.teacherHomepage.settings.countsHint') }}
          </p>
          <div class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <Statistic
              v-for="{ key, value } in countRows"
              :key="key"
              :title="t(`page.teacherHomepage.settings.count.${key}`)"
              :value="value"
            >
              <template #formatter>{{ format.number(value) }}</template>
            </Statistic>
          </div>
        </template>
      </LoadState>
    </Card>
    <Card :bordered="false" :title="t('page.teacherHomepage.settings.allowlist')">
      <p class="mb-4 text-sm text-muted-foreground">
        {{ t('page.teacherHomepage.settings.allowlistHint') }}
      </p>
      <MutationAlert
        class="mb-4"
        :busy="save.busy.value"
        :uncertain="save.uncertain.value"
        :error="needsRebase ? '' : save.error.value"
        :success="saved ? t('page.common.saved') : ''"
        @retry="retrySave"
      />
      <LoadState
        :status="allowlist.status.value"
        :error="allowlist.error.value"
        @retry="readAllowlist"
      >
        <Form v-if="baseline" layout="vertical" @submit.prevent="submit">
          <Alert
            v-if="rebased"
            class="mb-4"
            type="warning"
            show-icon
            role="status"
            :message="t('page.teacherHomepage.settings.conflict')"
          />
          <fieldset class="mb-6">
            <legend class="mb-2 text-base font-medium">
              {{ t('page.teacherHomepage.settings.standardFields') }}
            </legend>
            <div class="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
              <Checkbox
                v-for="field in standardFields"
                :key="field"
                :checked="selected.has(fieldKey({ field }))"
                :disabled="disabled || (atLimit && !selected.has(fieldKey({ field })))"
                @change="toggleStandard(field)"
              >
                {{ t(`page.teacherHomepage.fields.${field}`) }}
              </Checkbox>
            </div>
          </fieldset>
          <fieldset>
            <legend class="mb-2 text-base font-medium">
              {{ t('page.teacherHomepage.settings.dynamicFields') }}
            </legend>
            <RadioGroup v-model:value="kind" class="mb-4" option-type="button">
              <RadioButton v-for="type in dynamicFields" :key="type" :value="type">
                {{ t(`page.teacherHomepage.settings.kind.${type}`) }}
              </RadioButton>
            </RadioGroup>
            <ul v-if="chosen.length > 0" class="mb-4 flex list-none flex-wrap gap-2 p-0">
              <li
                v-for="entry in chosen"
                :key="fieldKey(entry)"
                class="inline-flex max-w-full items-center gap-1 rounded border px-2 py-0.5"
              >
                <bdi class="min-w-0 break-words">{{ entry.label }}</bdi>
                <Button
                  size="small"
                  type="text"
                  :aria-label="t('page.teacherHomepage.settings.remove', { label: entry.label })"
                  :disabled="disabled"
                  @click="remove(entry)"
                >
                  <CloseIcon class="size-4" aria-hidden="true" />
                </Button>
              </li>
            </ul>
            <p v-else class="mb-4 text-sm text-muted-foreground">
              {{ t('page.teacherHomepage.settings.empty') }}
            </p>
            <FormItem
              :label="t(`page.teacherHomepage.settings.label.${kind}`)"
              :help="labelError ? t(`page.teacherHomepage.settings.${labelError}`) : undefined"
              :validate-status="labelError ? 'error' : undefined"
              html-for="teacher-homepage-allowlist-label"
            >
              <div class="flex flex-wrap gap-2">
                <Input
                  id="teacher-homepage-allowlist-label"
                  v-model:value="label"
                  class="max-w-sm"
                  :disabled="disabled"
                  :maxlength="labelLimit * 2"
                  :aria-invalid="!!labelError"
                  @press-enter.prevent="addLabel"
                />
                <Button :disabled="disabled || !label.trim()" @click="addLabel">
                  {{ t('page.teacherHomepage.settings.add') }}
                </Button>
              </div>
            </FormItem>
          </fieldset>
          <Alert
            v-if="fields.length > allowlistLimit"
            class="mb-4"
            type="error"
            show-icon
            role="alert"
            :message="t('page.teacherHomepage.settings.limit')"
          />
          <div v-if="canMaintain" class="flex flex-wrap gap-2">
            <Button
              type="primary"
              html-type="submit"
              :loading="save.busy.value"
              :disabled="disabled || !dirty || fields.length > allowlistLimit"
            >
              {{ t('page.common.save') }}
            </Button>
            <Button :disabled="disabled || (!dirty && !label.trim())" @click="discard">
              {{ t('page.common.discard') }}
            </Button>
          </div>
        </Form>
      </LoadState>
    </Card>
  </div>
</template>
