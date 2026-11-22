<script setup lang="ts">
import type { ProfileOverride } from './profileRules';

import { computed, onScopeDispose, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button } from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useErrorText } from '#/shared/ui/messages';

import { useTeacherHomepageProfile } from './profileApi';
import { encodeProfilePhoto, profilePhotoBlob } from './profilePhoto';

const props = defineProps<{
  canPreviewSaved: boolean;
  disabled: boolean;
  inputId: string;
  teacherId: string;
  value?: ProfileOverride['photo'];
}>();
const emit = defineEmits<{
  busy: [value: boolean];
  change: [value: NonNullable<ProfileOverride['photo']>];
}>();

const { t } = useI18n();
const errorText = useErrorText();
const api = useTeacherHomepageProfile();
const url = ref('');
const fileInput = ref<HTMLInputElement>();
const pending = ref(false);
const failure = ref('');
const failureText = computed(() => {
  switch (failure.value) {
    case 'invalid-photo': {
      return t('page.teacherHomepage.profile.photo.invalid');
    }
    case 'large-photo': {
      return t('page.teacherHomepage.profile.photo.tooLarge');
    }
    case 'restricted-photo': {
      return t('page.teacherHomepage.profile.photo.unavailable');
    }
    default: {
      return failure.value ? errorText(failure.value) : '';
    }
  }
});
let read: AbortController | undefined;
let uploadVersion = 0;
let disposed = false;

function show(blob?: Blob) {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = blob ? URL.createObjectURL(blob) : '';
}

function close() {
  read?.abort();
  read = undefined;
  pending.value = false;
  failure.value = '';
  show();
}

watch(
  () => props.value,
  (value) => {
    close();
    if (value && 'data' in value) show(profilePhotoBlob(value));
  },
  { immediate: true },
);
watch(
  () => props.canPreviewSaved,
  (allowed) => {
    if (!allowed && props.value && 'id' in props.value) close();
  },
);

onScopeDispose(() => {
  disposed = true;
  uploadVersion++;
  close();
  emit('busy', false);
});

async function previewSaved() {
  if (!props.canPreviewSaved || !props.value || !('id' in props.value)) return;
  close();
  const controller = new AbortController();
  read = controller;
  pending.value = true;
  try {
    const photo = await api.getSavedPhoto(props.teacherId, props.value.id, controller.signal);
    if (read === controller) show(photo);
  } catch (error) {
    if (read !== controller) return;
    const code = errorCode(error);
    failure.value = ['forbidden', 'not_found', 'unauthenticated'].includes(code)
      ? 'restricted-photo'
      : code;
  } finally {
    if (read === controller) pending.value = false;
  }
}

async function selectPhoto(event: Event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.item(0);
  input.value = '';
  if (!file || disposed) return;
  const version = ++uploadVersion;
  failure.value = '';
  emit('busy', true);
  try {
    const value = await encodeProfilePhoto(file);
    if (version === uploadVersion) emit('change', value);
  } catch (error) {
    if (version !== uploadVersion) return;
    failure.value =
      errorCode(error) === 'capacity_exceeded'
        ? 'large-photo'
        : 'invalid-photo';
  } finally {
    if (version === uploadVersion) emit('busy', false);
  }
}
</script>

<template>
  <div class="flex flex-col items-start gap-2">
    <template v-if="value && 'id' in value">
      <p>{{ t('page.teacherHomepage.profile.photo.saved') }}</p>
      <Button
        v-if="canPreviewSaved && !url"
        :loading="pending"
        @click="previewSaved"
      >
        {{ t('page.teacherHomepage.profile.photo.preview') }}
      </Button>
      <p v-if="!canPreviewSaved" class="text-muted-foreground">
        {{ t('page.teacherHomepage.profile.photo.unavailable') }}
      </p>
      <Button v-if="url" @click="close">
        {{ t('page.teacherHomepage.profile.photo.close') }}
      </Button>
    </template>
    <img
      v-if="url"
      :src="url"
      :alt="t('page.teacherHomepage.profile.photo.alt')"
      class="max-h-48 max-w-full rounded object-contain"
      data-testid="teacher-homepage-photo-preview"
    />
    <Button :disabled="disabled" :aria-describedby="`${inputId}-help`" @click="fileInput?.click()">
      {{ t('page.teacherHomepage.profile.photo.choose') }}
    </Button>
    <input
      :id="inputId"
      ref="fileInput"
      :aria-label="t('page.teacherHomepage.profile.photo.choose')"
      :aria-describedby="`${inputId}-help`"
      :disabled="disabled"
      accept="image/jpeg,image/png"
      hidden
      data-testid="teacher-homepage-photo-input"
      type="file"
      @change="selectPhoto"
    />
    <p :id="`${inputId}-help`" class="text-muted-foreground">
      {{ t('page.teacherHomepage.profile.photo.formats') }}
    </p>
    <Alert v-if="failureText" role="alert" show-icon type="error" :message="failureText" />
  </div>
</template>
