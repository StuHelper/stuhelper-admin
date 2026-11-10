<script setup lang="ts">
import { useI18n } from '@vben/locales';

import { Input } from 'ant-design-vue';

// Display names in every interface language. Chinese is required as the fallback.
withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });
const model = defineModel<Record<string, string>>({ required: true });
const { t } = useI18n();
const languages = ['zh-CN', 'en-US', 'fr-FR', 'ru-RU', 'ja-JP', 'ko-KR', 'es-ES', 'ar-EG'];

function change(language: string, value: string) {
  const next = { ...model.value };
  if (value) next[language] = value;
  else delete next[language];
  model.value = next;
}
</script>

<template>
  <fieldset class="rounded border p-3">
    <legend class="px-1 text-sm font-semibold">{{ t('page.resources.names') }}</legend>
    <div class="grid gap-3 sm:grid-cols-2">
      <label v-for="language in languages" :key="language" class="flex flex-col gap-1 text-sm">
        <span>{{ t(`page.resources.languageNames.${language}`) }}<span v-if="language === 'zh-CN'" aria-hidden="true" class="text-destructive ms-1 after:content-['*']"></span></span>
        <Input :value="model[language] ?? ''" :lang="language" :dir="language === 'ar-EG' ? 'rtl' : 'ltr'" :maxlength="200" :disabled="disabled" @update:value="change(language, $event)" />
      </label>
    </div>
  </fieldset>
</template>
