<script setup lang="ts">
import { useI18n } from '@vben/locales';

const props = withDefaults(
  defineProps<{
    countCodePoints?: boolean;
    disabled?: boolean;
    maxLength?: number;
    modelValue: string;
    presets: { key: string; text: string }[];
  }>(),
  {
    countCodePoints: false,
    disabled: false,
    maxLength: 2000,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useI18n();

function apply(text: string) {
  if (props.disabled) return;
  const current = props.countCodePoints ? props.modelValue : props.modelValue.trim();
  if (current && current.includes(text)) return;
  const next = current ? `${current} ${text}` : text;
  if (props.countCodePoints) {
    // Preserve the draft when the whole preset would exceed the available space.
    if ([...next].length <= props.maxLength) emit('update:modelValue', next);
  } else {
    emit('update:modelValue', next.slice(0, props.maxLength));
  }
}
</script>

<template>
  <div
    v-if="presets.length > 0"
    class="mb-2 flex min-w-0 flex-wrap items-center gap-1.5"
    role="group"
    :aria-label="t('page.moderation.presetsLabel')"
  >
    <span class="text-muted-foreground text-xs">
      {{ t('page.moderation.presetsLabel') }}:
    </span>
    <button
      v-for="preset in presets"
      :key="preset.key"
      type="button"
      :disabled="disabled"
      class="border-border bg-muted/40 hover:bg-muted max-w-full rounded border px-2 py-0.5 text-start text-xs break-words whitespace-normal disabled:opacity-50"
      @click="apply(preset.text)"
    >
      {{ preset.text }}
    </button>
  </div>
</template>
