<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Space } from 'ant-design-vue';

const props = withDefaults(
  defineProps<{
    contentType: string;
    label: string;
    maxBytes?: number;
    size?: number;
    tooLarge?: boolean;
    url?: string;
  }>(),
  {
    maxBytes: 15 * 1024 * 1024,
    size: undefined,
    tooLarge: false,
    url: '',
  },
);

const { t } = useI18n();
const rotation = ref(0);
const scale = ref(1);

watch(
  () => props.url,
  () => {
    rotation.value = 0;
    scale.value = 1;
  },
);

const exceeds = computed(
  () => props.tooLarge || (props.size !== undefined && props.size > props.maxBytes),
);
const isImage = computed(() => props.contentType.startsWith('image/'));
const isPdf = computed(() => props.contentType === 'application/pdf');

function rotate(delta: number) {
  rotation.value = (rotation.value + delta + 360) % 360;
}

function zoom(delta: number) {
  const next = Number((scale.value + delta).toFixed(2));
  scale.value = Math.min(3, Math.max(0.5, next));
}

function reset() {
  rotation.value = 0;
  scale.value = 1;
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2 rounded border p-3">
    <template v-if="exceeds">
      <Alert
        type="warning"
        show-icon
        :message="t('page.resources.previewTooLarge')"
      />
      <a
        v-if="url"
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        class="break-all text-xs underline"
      >
        {{ label }}
      </a>
    </template>
    <template v-else-if="isImage && url">
      <Space wrap size="small">
        <Button size="small" html-type="button" @click="rotate(-90)">
          {{ t('page.resources.rotateLeft') }}
        </Button>
        <Button size="small" html-type="button" @click="rotate(90)">
          {{ t('page.resources.rotateRight') }}
        </Button>
        <Button size="small" html-type="button" :disabled="scale <= 0.5" @click="zoom(-0.25)">
          {{ t('page.resources.zoomOut') }}
        </Button>
        <Button size="small" html-type="button" :disabled="scale >= 3" @click="zoom(0.25)">
          {{ t('page.resources.zoomIn') }}
        </Button>
        <Button
          v-if="rotation !== 0 || scale !== 1"
          size="small"
          html-type="button"
          @click="reset"
        >
          {{ t('page.resources.resetView') }}
        </Button>
      </Space>
      <div class="bg-muted/20 flex max-h-96 min-h-40 items-center justify-center overflow-auto rounded border p-2">
        <img
          :src="url"
          :alt="label"
          class="max-h-80 max-w-full object-contain transition-transform"
          :style="{ transform: `rotate(${rotation}deg) scale(${scale})` }"
        />
      </div>
    </template>
    <template v-else-if="isPdf && url">
      <iframe
        sandbox=""
        :src="url"
        :title="label"
        class="h-96 w-full rounded border"
      ></iframe>
      <a
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        class="break-all text-xs underline"
      >
        {{ label }}
      </a>
    </template>
    <Alert
      v-else
      type="info"
      show-icon
      :message="t('page.resources.previewUnsupported')"
    />
  </div>
</template>
