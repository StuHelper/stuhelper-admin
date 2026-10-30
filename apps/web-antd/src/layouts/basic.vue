<script setup lang="ts">
import { BasicLayout } from '@vben/layouts';

import SessionControls from '#/components/SessionControls.vue';
</script>

<template>
  <BasicLayout>
    <template #user-dropdown>
      <SessionControls />
    </template>
  </BasicLayout>
</template>
