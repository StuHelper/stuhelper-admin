<script setup lang="ts">
import { useI18n } from '@vben/locales';
defineProps<{ disabled?: boolean; modelValue: Record<string, string> }>();
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>];
}>();
const { t } = useI18n();
const languages = [
  'zh-CN',
  'en-US',
  'ja-JP',
  'ko-KR',
  'fr-FR',
  'es-ES',
  'ru-RU',
  'ar-EG',
];
function change(event: Event, language: string, value: Record<string, string>) {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    const next = { ...value };
    if (target.value) next[language] = target.value;
    else delete next[language];
    emit('update:modelValue', next);
  }
}
</script>
<template>
  <fieldset :disabled="disabled">
    <legend>{{ t('page.resources.names') }}</legend>
    <div class="resource-grid">
      <label
        v-for="language in languages"
        :key="language"
        class="resource-field"
        >{{ language
        }}<input
          :value="modelValue[language] ?? ''"
          :lang="language"
          :dir="language === 'ar-EG' ? 'rtl' : 'ltr'"
          :required="language === 'zh-CN'"
          maxlength="200"
          @input="change($event, language, modelValue)"
      /></label>
    </div>
  </fieldset>
</template>
