<script setup lang="ts">
import type {
  ProfileOverride,
  ProfileRule,
  ProfileSupervisor,
} from './profileRules';

import { computed } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Card, Checkbox, Input, Textarea } from 'ant-design-vue';

import ProfilePortraitInput from './ProfilePortraitInput.vue';
import {
  emptyProfileOverride,
  profileFieldKey,
  profileSupervisors,
  profileValueKind,
  supervisorKeys,
} from './profileRules';

const props = defineProps<{
  disabled: boolean;
  index: number;
  rule: Readonly<ProfileRule>;
  savedPhotoPreview: boolean;
  teacherId: string;
}>();
const emit = defineEmits<{
  change: [rule: ProfileRule];
  photoBusy: [value: boolean];
  remove: [];
}>();

const { t } = useI18n();
const inputId = computed(() => `teacher-homepage-rule-${props.index}`);
const kind = computed(() => profileValueKind(props.rule.field));
const groupRows = computed(() =>
  kind.value === 'fields'
    ? props.rule.override?.fields?.map(({ label, value }) => ({ label, text: value })) ?? []
    : props.rule.override?.sections?.map(({ title, text }) => ({ label: title, text })) ?? [],
);
const title = computed(() =>
  props.rule.field.label
    ? `${t(profileFieldKey(props.rule.field.field))} · ${props.rule.field.label}`
    : t(profileFieldKey(props.rule.field.field)),
);
function replace(override?: ProfileOverride) {
  emit('change', { field: props.rule.field, hidden: props.rule.hidden, override });
}

function toggleSupervisor(supervisor: ProfileSupervisor, checked: boolean) {
  const selected = new Set(props.rule.override?.supervisors);
  if (checked) selected.add(supervisor);
  else selected.delete(supervisor);
  replace({ supervisors: profileSupervisors.filter((option) => selected.has(option)) });
}

function setRows(rows: Array<{ label: string; text: string }>) {
  replace(
    kind.value === 'fields'
      ? { fields: rows.map(({ label, text }) => ({ label, value: text })) }
      : { sections: rows.map(({ label, text }) => ({ title: label, text })) },
  );
}
</script>

<template>
  <Card data-testid="teacher-homepage-rule" size="small" :title="title">
    <template #extra>
      <Button
        data-testid="teacher-homepage-remove-rule"
        :disabled="disabled"
        type="text"
        @click="emit('remove')"
      >
        {{ t('page.teacherHomepage.profile.removeRule') }}
      </Button>
    </template>

    <div class="flex flex-wrap gap-3">
      <Checkbox
        :checked="rule.hidden"
        :disabled="disabled"
        @update:checked="emit('change', { ...rule, hidden: $event === true })"
      >
        {{ t('page.teacherHomepage.profile.hideField') }}
      </Checkbox>
      <Checkbox
        :checked="!!rule.override"
        :disabled="disabled"
        data-testid="teacher-homepage-override"
        @update:checked="replace($event ? emptyProfileOverride(rule.field) : undefined)"
      >
        {{ t('page.teacherHomepage.profile.override') }}
      </Checkbox>
    </div>

    <div v-if="rule.override" class="mt-3 flex flex-col gap-3">
      <ProfilePortraitInput
        v-if="kind === 'photo'"
        :can-preview-saved="savedPhotoPreview"
        :disabled="disabled"
        :input-id="inputId"
        :teacher-id="teacherId"
        :value="rule.override.photo"
        @busy="emit('photoBusy', $event)"
        @change="replace({ photo: $event })"
      />
      <div v-else-if="kind === 'supervisors'" class="flex flex-wrap gap-3">
        <Checkbox
          v-for="option in profileSupervisors"
          :key="option"
          :checked="rule.override.supervisors?.includes(option)"
          :disabled="disabled"
          @update:checked="toggleSupervisor(option, $event === true)"
        >
          {{ t(`page.teacherHomepage.supervisors.${supervisorKeys[option]}`) }}
        </Checkbox>
      </div>
      <template v-else-if="kind === 'fields' || kind === 'sections'">
        <div
          v-for="(row, rowIndex) in groupRows"
          :key="rowIndex"
          class="rounded border p-3"
        >
          <div class="mb-2 flex flex-col gap-2">
            <label :for="`${inputId}-label-${rowIndex}`">
              {{
                t(
                  kind === 'fields'
                    ? 'page.teacherHomepage.profile.pairLabel'
                    : 'page.teacherHomepage.profile.pairTitle',
                )
              }}
            </label>
            <Input
              :id="`${inputId}-label-${rowIndex}`"
              :value="row.label"
              :disabled="disabled"
              @update:value="setRows(groupRows.map((item, index) => index === rowIndex ? { ...item, label: $event } : item))"
            />
            <label :for="`${inputId}-value-${rowIndex}`">
              {{ t('page.teacherHomepage.profile.pairValue') }}
            </label>
            <Textarea
              :id="`${inputId}-value-${rowIndex}`"
              :value="row.text"
              :disabled="disabled"
              :rows="2"
              @update:value="setRows(groupRows.map((item, index) => index === rowIndex ? { ...item, text: $event } : item))"
            />
          </div>
          <Button
            :disabled="disabled"
            @click="setRows(groupRows.filter((_, index) => index !== rowIndex))"
          >
            {{ t('page.teacherHomepage.profile.removeValue') }}
          </Button>
        </div>
        <Button
          class="self-start"
          :disabled="disabled || groupRows.length >= (kind === 'fields' ? 128 : 64)"
          @click="setRows([...groupRows, { label: '', text: '' }])"
        >
          {{ t('page.teacherHomepage.profile.addValue') }}
        </Button>
      </template>
      <template v-else>
        <label :for="inputId">{{ t('page.teacherHomepage.profile.overrideValue') }}</label>
        <Textarea
          :id="inputId"
          :value="rule.override.text"
          :disabled="disabled"
          :rows="3"
          @update:value="replace({ text: $event })"
        />
      </template>
    </div>
  </Card>
</template>
