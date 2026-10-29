<script setup lang="ts">
import { computed, ref } from 'vue';

import { useI18n } from '@vben/locales';

import { attribute, type Field, name, type Value } from './api';
const props = defineProps<{
  disabled?: boolean;
  field: Field;
  filter?: boolean;
  modelValue?: Value;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: undefined | Value] }>();
const { locale, t } = useI18n();
const invalid = ref(false);
const raw = computed(
  () =>
    props.modelValue?.text ??
    props.modelValue?.option ??
    String(props.modelValue?.number ?? ''),
);
function change(event: Event) {
  const input = event.target;
  if (
    !(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)
  )
    return;
  try {
    const value = attribute(props.field, input.value);
    invalid.value = false;
    input.setCustomValidity('');
    emit('update:modelValue', value);
  } catch {
    invalid.value = true;
    input.setCustomValidity(t('page.resources.errors.invalid_input'));
  }
}
</script>
<template>
  <label class="resource-field">{{ name(field.names, locale)
    }}<select
      v-if="field.kind === 'choice'"
      :value="raw"
      :aria-invalid="invalid"
      :required="!filter && field.required"
      :disabled="disabled"
      @change="change"
    >
      <option value="">{{ t('page.resources.choose') }}</option>
      <option
        v-for="option in field.options"
        :key="option.id"
        :value="option.id"
      >
        {{ name(option.names, locale) }}
      </option></select><input
      v-else
      :value="raw"
      :aria-invalid="invalid"
      :type="field.kind === 'integer' ? 'number' : 'text'"
      :min="field.min"
      :max="field.max"
      :maxlength="field.max_length"
      :step="field.kind === 'integer' ? 1 : undefined"
      :required="!filter && field.required"
      :disabled="disabled"
      @input="change"
  /></label>
</template>
