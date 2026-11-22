<script setup lang="ts">
import type { CatalogSchemas } from './catalog';

import { ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Button, Card } from 'ant-design-vue';

import { useAsync } from '#/shared/composables/async';
import LoadState from '#/shared/ui/LoadState.vue';

import { useTeacherHomepageProfile } from './profileApi';

const props = defineProps<{ teacherId: string }>();
const { t } = useI18n();
const api = useTeacherHomepageProfile();
const list = useAsync(async (signal) => {
  const [photo, images] = await Promise.all([
    api.visiblePhoto(props.teacherId, signal),
    api.bodyImages(props.teacherId, signal),
  ]);
  return { photo, images };
});

type Image = CatalogSchemas['TeacherHomepageCopiedImage'] | CatalogSchemas['TeacherHomepagePhoto'];
const selected = ref<Image>();
const preview = useAsync(async (signal) => {
  const item = selected.value;
  if (!item) return;
  return 'image' in item ? api.bodyImage(item, signal) : api.sourcePhoto(item.url, signal);
});
const url = ref('');
const broken = ref(false);
watch(preview.data, (blob, _, cleanup) => {
  if (!blob) return;
  url.value = URL.createObjectURL(blob);
  cleanup(() => {
    URL.revokeObjectURL(url.value);
    url.value = '';
  });
}, { flush: 'sync' });

function open(item: Image) {
  broken.value = false;
  selected.value = item;
  void preview.reload();
}

function decodeFailed() {
  preview.clear();
  broken.value = true;
}

function close() {
  broken.value = false;
  preview.clear();
  selected.value = undefined;
  list.clear();
}
</script>

<template>
  <Card :bordered="false" :title="t('page.teacherHomepage.profile.images')">
    <Button v-if="list.status.value === 'idle'" @click="list.reload">
      {{ t('page.common.open') }}
    </Button>
    <template v-else>
      <Button @click="close">{{ t('page.teacherHomepage.profile.photo.close') }}</Button>
      <LoadState :status="list.status.value" :error="list.error.value" :empty="!list.data.value?.photo && !list.data.value?.images.length" @retry="list.reload">
        <div class="my-2 flex flex-wrap gap-2">
          <Button v-if="list.data.value?.photo" @click="open(list.data.value.photo)">
            {{ t('page.teacherHomepage.fields.photo') }}
          </Button>
          <Button v-for="(item, index) in list.data.value?.images" :key="index" @click="open(item)">
            {{ item.title || t('page.teacherHomepage.profile.bodyImage', { number: index + 1 }) }}
          </Button>
        </div>
        <LoadState
          :status="broken ? 'error' : preview.status.value"
          :error="broken ? 'incompatible' : preview.error.value"
          @retry="selected && open(selected)"
        >
          <img v-if="url" :src="url" :alt="selected && 'image' in selected ? selected.title || t('page.teacherHomepage.profile.images') : t('page.teacherHomepage.fields.photo')" class="max-h-96 max-w-full object-contain" @error="decodeFailed" />
        </LoadState>
      </LoadState>
    </template>
  </Card>
</template>
