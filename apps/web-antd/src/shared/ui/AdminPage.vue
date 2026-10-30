<script setup lang="ts">
import { Page } from '@vben/common-ui';

// Vben's page frame with a large title as the page's level-one heading. The
// header sits directly on the page background, as large titles do on Apple platforms.
defineProps<{ description?: string; title: string }>();
</script>

<template>
  <Page
    :description="description"
    content-class="!px-4 !pt-2"
    header-class="!border-0 !bg-transparent flex-wrap gap-3 !px-4 !pb-1 !pt-4"
  >
    <template #title>
      <h1 class="mb-1 text-xl font-semibold leading-tight">{{ title }}</h1>
    </template>
    <template v-if="$slots.extra" #extra>
      <slot name="extra"></slot>
    </template>
    <slot></slot>
  </Page>
</template>
