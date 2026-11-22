<script setup lang="ts">
import type { Variable } from './api';

import type { ApiError } from '#/shared/api/errors';

import { nextTick, ref } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button } from 'ant-design-vue';

import { usePaged } from '#/shared/composables/async';
import { useErrorText } from '#/shared/ui/messages';

import { useLegalApi } from './api';

defineProps<{ locked: boolean }>();
const emit = defineEmits<{ denied: [error: ApiError] }>();
const markdown = defineModel<string>({ required: true });
const { t } = useI18n();
const api = useLegalApi();
const errorText = useErrorText();
const area = ref<HTMLTextAreaElement>();
const picker = ref<HTMLSelectElement>();
const selecting = ref(false);
const selected = ref('');
const variables = usePaged<Variable>(
  async (cursor, signal) => {
    const page = await api.listVariables(Number(cursor), signal, 25);
    return { items: page.items, next: page.next_offset?.toString() ?? '' };
  },
  { onDenied: (error) => emit('denied', error) },
);
const metadataKeys = ['document_version', 'effective_date'] as const;
const caption = (key: string) => t(`page.legal.documents.${key}`);

function togglePicker() {
  selecting.value = !selecting.value;
  if (!selecting.value) return;
  if (variables.status.value === 'idle') void variables.reload();
  void nextTick(() => picker.value?.focus());
}

function insert() {
  if (!area.value || !selected.value) return;
  const { selectionEnd, selectionStart } = area.value;
  const token = `{{${selected.value}}}`;
  markdown.value = markdown.value.slice(0, selectionStart) + token + markdown.value.slice(selectionEnd);
  selecting.value = false;
  selected.value = '';
  void nextTick(() => {
    area.value?.focus();
    const cursor = selectionStart + token.length;
    area.value?.setSelectionRange(cursor, cursor);
  });
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <textarea
      id="legal-document-markdown"
      ref="area"
      v-model="markdown"
      class="ant-input min-h-[16rem] w-full resize-y font-mono"
      :disabled="locked"
      :maxlength="131072"
      dir="auto"
      required
    ></textarea>
    <div>
      <Button
        :aria-expanded="selecting"
        :disabled="locked"
        aria-controls="legal-variable-picker"
        @click="togglePicker"
      >
{{ caption('insertVariable') }}
</Button>
    </div>
    <div v-if="selecting" id="legal-variable-picker" class="flex min-w-0 flex-col gap-2">
      <label for="legal-document-variable">{{ caption('variable') }}</label>
      <select
        id="legal-document-variable"
        ref="picker"
        v-model="selected"
        class="ant-input w-full max-w-lg"
        dir="ltr"
        :disabled="locked"
      >
        <option disabled value="">{{ t('page.common.choose') }}</option>
        <optgroup :label="caption('variableGroupMetadata')">
          <option v-for="key in metadataKeys" :key="key" :value="key">{{ key }}</option>
        </optgroup>
        <optgroup v-if="variables.items.value.length > 0" :label="caption('variableGroupGlobal')">
          <option v-for="item in variables.items.value" :key="item.key" :value="item.key">{{ item.key }}</option>
        </optgroup>
      </select>
      <Alert
        v-if="variables.error.value"
        type="error"
        show-icon
        role="alert"
        :message="errorText(variables.error.value)"
      />
      <div class="flex flex-wrap gap-2">
        <Button :disabled="locked || !selected" @click="insert">{{ caption('insertVariable') }}</Button>
        <Button
          v-if="variables.status.value === 'loading' || variables.next.value || variables.error.value"
          :disabled="locked"
          :loading="variables.status.value === 'loading'"
          @click="variables.next.value ? variables.loadMore() : variables.reload()"
        >
{{ t(variables.error.value ? 'page.common.retry' : 'page.common.loadMore') }}
</Button>
      </div>
    </div>
  </div>
</template>
