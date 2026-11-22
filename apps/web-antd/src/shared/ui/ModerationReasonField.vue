<script setup lang="ts">
import { computed } from 'vue';

import { useI18n } from '@vben/locales';

import { FormItem, Textarea } from 'ant-design-vue';

import { useFormat } from '#/shared/format';

import { moderationReasonLimit } from './moderation-reason';
import ReasonPresets from './ReasonPresets.vue';

const props = defineProps<{
  disabled?: boolean;
  id: string;
  label: string;
  presets?: { key: string; text: string }[];
}>();
const reason = defineModel<string>({ required: true });
const { t } = useI18n();
const format = useFormat();
const length = computed(() => [...reason.value].length);
const tooLong = computed(() => length.value > moderationReasonLimit);
const description = computed(() =>
  tooLong.value ? `${props.id}-count ${props.id}-error` : `${props.id}-count`,
);
</script>

<template>
  <FormItem
    :label="label"
    :html-for="id"
    :validate-status="tooLong ? 'error' : undefined"
    required
  >
    <ReasonPresets
      v-if="presets"
      v-model="reason"
      :presets="presets"
      :disabled="disabled"
      :max-length="moderationReasonLimit"
      count-code-points
    />
    <Textarea
      :id="id"
      v-model:value="reason"
      :rows="3"
      :disabled="disabled"
      :aria-describedby="description"
      :aria-invalid="tooLong || undefined"
    />
    <template #extra>
      <span :id="`${id}-count`">{{ format.number(length) }} / {{ format.number(moderationReasonLimit) }}</span>
    </template>
    <template v-if="tooLong" #help>
      <span :id="`${id}-error`">{{
        t('page.moderation.reasonTooLong', { limit: format.number(moderationReasonLimit) })
      }}</span>
    </template>
  </FormItem>
</template>
