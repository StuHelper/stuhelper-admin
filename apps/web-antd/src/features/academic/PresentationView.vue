<script setup lang="ts">
import type { Presentation } from './api';

import { computed, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import {
  Alert,
  Button,
  Card,
  Form,
  FormItem,
  Input,
  InputNumber,
  Select,
  Space,
} from 'ant-design-vue';

import arEG from '#/locales/langs/ar-EG/page.json';
import enUS from '#/locales/langs/en-US/page.json';
import esES from '#/locales/langs/es-ES/page.json';
import frFR from '#/locales/langs/fr-FR/page.json';
import jaJP from '#/locales/langs/ja-JP/page.json';
import koKR from '#/locales/langs/ko-KR/page.json';
import ruRU from '#/locales/langs/ru-RU/page.json';
import zhCN from '#/locales/langs/zh-CN/page.json';
import { useAsync, useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { dimensions, useAcademicAdmin } from './api';
import { useCampusId } from './campus';
import CampusPending from './CampusPending.vue';

// Preview limits and five-level rating wording per language. Without a saved
// configuration the built-in wording of each language is the starting point.
const { t, locale } = useI18n();
const api = useAcademicAdmin();
const save = useMutation();
const dictionaries = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'fr-FR': frFR,
  'ru-RU': ruRU,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'es-ES': esES,
  'ar-EG': arEG,
};
const school = useCampusId();
const scope = ref<'global' | 'school'>('school');
const language = ref(locale.value);
const form = ref<Presentation>();
const current = shallowRef<Presentation>();
const baseline = ref('');
const success = ref('');
const target = computed(() => (scope.value === 'global' ? '*' : school.value));
const dirty = computed(
  () => !!form.value && JSON.stringify(form.value) !== baseline.value,
);
const locked = computed(() => save.busy.value || save.uncertain.value);
const view = useAsync((signal) => api.presentation(target.value, signal));

function defaults(): Presentation['rating_texts'] {
  return Object.fromEntries(
    Object.entries(dictionaries).map(([lang, dictionary]) => [
      lang,
      dimensions.map((name) => {
        const rating = dictionary.moderation.ratings[name];
        return [
          rating.label,
          rating.level1,
          rating.level2,
          rating.level3,
          rating.level4,
          rating.level5,
        ];
      }),
    ]),
  );
}

async function load(compare = false) {
  await view.reload();
  const value = view.data.value;
  if (!value) return;
  if (compare && form.value) {
    // Keep the edits; adopt the current revision and show the saved values for comparison.
    form.value.revision = value.configured?.revision ?? 0;
    current.value = value.effective;
    return;
  }
  form.value = {
    ...value.effective,
    school_id: target.value,
    revision: value.configured?.revision ?? 0,
    rating_texts:
      Object.keys(value.effective.rating_texts).length > 0
        ? structuredClone(value.effective.rating_texts)
        : defaults(),
  };
  baseline.value = JSON.stringify(form.value);
  current.value = undefined;
}
watch(target, () => {
  success.value = '';
  if (target.value) void load();
});
useLeaveGuard(() => (dirty.value || locked.value ? t(save.uncertain.value ? 'page.common.leaveUncertain' : 'page.common.leaveUnsaved') : ''));

async function submit() {
  if (!form.value) return;
  success.value = '';
  if (
    await save.run(`presentation:${target.value}`, form.value, (value, key) =>
      api.savePresentation(value, key),
    )
  )
    saved();
}
async function retry() {
  if (await save.retry()) saved();
}
async function saved() {
  success.value = t('page.common.saved');
  await load();
}
</script>

<template>
  <AdminPage
    :title="t('page.moderation.presentationTitle')"
    :description="t('page.moderation.presentationIntro')"
  >
    <div class="flex flex-col gap-4">
      <Card :bordered="false">
        <Form layout="inline" class="flex flex-wrap gap-y-3" />
      </Card>
      <CampusPending v-if="!target" @ready="school = $event" />
      <Card v-if="target" :bordered="false">
        <LoadState
          :status="view.status.value"
          :error="view.error.value"
          @retry="load()"
        >
          <Form v-if="form" layout="vertical" @submit.prevent="submit">
            <Alert
              v-if="current"
              class="mb-4"
              type="warning"
              show-icon
              :message="t('page.common.compareNotice')"
              :description="
                t('page.moderation.savedLimits', {
                  guest: current.guest_preview,
                  member: current.member_preview,
                  ratio: current.preview_ratio,
                })
              "
            />
            <div class="grid gap-4 md:grid-cols-3">
              <FormItem
                :label="t('page.moderation.guestPreview')"
                :extra="t('page.moderation.previewHint')"
               html-for="presentationview-field-1"
>
                <InputNumber
id="presentationview-field-1"
                  v-model:value="form.guest_preview"
                  :min="0"
                  :max="1000"
                  :precision="0"
                  :disabled="locked"
                  class="w-full"
                />
              </FormItem>
              <FormItem :label="t('page.moderation.memberPreview')" html-for="presentationview-field-2">
                <InputNumber
id="presentationview-field-2"
                  v-model:value="form.member_preview"
                  :min="0"
                  :max="1000"
                  :precision="0"
                  :disabled="locked"
                  class="w-full"
                />
              </FormItem>
              <FormItem
                :label="t('page.moderation.previewRatio')"
                :extra="t('page.moderation.previewRatioHint')"
               html-for="presentationview-field-3"
>
                <InputNumber
id="presentationview-field-3"
                  v-model:value="form.preview_ratio"
                  :min="0.001"
                  :max="0.999"
                  :step="0.05"
                  :disabled="locked"
                  class="w-full"
                />
              </FormItem>
            </div>
            <FormItem :label="t('page.moderation.ratingLanguage')" html-for="presentationview-field-4">
              <Select
id="presentationview-field-4"
                v-model:value="language"
                class="w-48"
                :options="
                  Object.keys(dictionaries).map((value) => ({
                    value,
                    label: value,
                  }))
                "
              />
            </FormItem>
            <div class="grid gap-4 lg:grid-cols-2">
              <fieldset
                v-for="(row, index) in form.rating_texts[language]"
                :key="`${language}-${index}`"
                class="rounded border p-3"
              >
                <legend class="px-1 font-semibold">
                  {{ t(`page.moderation.ratings.${dimensions[index]}.label`) }}
                </legend>
                <FormItem
                  v-for="(_, level) in row"
                  :key="level"
                  :label="
                    level === 0
                      ? t('page.moderation.dimensionName')
                      : t('page.moderation.levelLabel', { level })
                  "
                  class="mb-2"
                 html-for="presentationview-field-5"
>
                  <Input
id="presentationview-field-5"
                    v-model:value="row[level]"
                    :maxlength="100"
                    :disabled="locked"
                    :lang="language"
                  />
                </FormItem>
              </fieldset>
            </div>
            <MutationAlert
              class="mt-4"
              :busy="save.busy.value"
              :error="save.error.value"
              :uncertain="save.uncertain.value"
              :success="success"
              @retry="retry"
            />
            <Space class="mt-4" wrap>
              <Button
                type="primary"
                html-type="submit"
                :loading="save.busy.value"
                :disabled="save.uncertain.value || !dirty"
                >
{{ t('page.common.save') }}
</Button>
              <Button
                v-if="save.error.value === 'conflict'"
                :disabled="locked"
                @click="load(true)"
                >
{{ t('page.common.reloadCompare') }}
</Button>
              <Button :disabled="locked || !dirty" @click="load()">
{{
                t('page.common.discard')
              }}
</Button>
            </Space>
          </Form>
        </LoadState>
      </Card>
    </div>
  </AdminPage>
</template>
