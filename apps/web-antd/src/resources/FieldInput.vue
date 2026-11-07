<script setup lang="ts">
import { computed, ref } from 'vue';

import { useI18n } from '@vben/locales';

import { Input, Select } from 'ant-design-vue';

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
// Text and number inputs keep the browser validity message; choices only show the error state.
function apply(raw: string, input?: HTMLInputElement) {
  try {
    const value = attribute(props.field, raw);
    invalid.value = false;
    input?.setCustomValidity('');
    emit('update:modelValue', value);
  } catch {
    invalid.value = true;
    input?.setCustomValidity(t('page.resources.errors.invalid_input'));
  }
}
function change(event: Event) {
  const input = event.target;
  if (input instanceof HTMLInputElement) apply(input.value, input);
}
function choose(value: string) {
  apply(value);
}
</script>
<template>
  <label class="resource-field">{{ name(field.names, locale) }}
    <Select
      v-if="field.kind === 'choice'"
      :value="raw"
      :status="invalid ? 'error' : undefined"
      :disabled="disabled"
      :options="[{ value: '', label: t('page.resources.choose') }, ...(field.options ?? []).map((option) => ({ value: option.id, label: name(option.names, locale) }))]"
      @change="choose(String($event ?? ''))"
    />
    <Input
      v-else
      :value="raw"
      :status="invalid ? 'error' : undefined"
      :aria-invalid="invalid"
      :type="field.kind === 'integer' ? 'number' : 'text'"
      :min="field.min"
      :max="field.max"
      :maxlength="field.max_length"
      :step="field.kind === 'integer' ? 1 : undefined"
      :required="!filter && field.required"
      :disabled="disabled"
      @change="change"
    />
  </label>
</template>
