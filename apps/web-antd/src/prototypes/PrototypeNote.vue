<script setup lang="ts">
import { Alert } from 'ant-design-vue';

defineProps<{ spec: string }>();
</script>

<template>
  <Alert type="warning" show-icon class="mb-4">
    <template #message>原型：数据为模拟数据，操作只改变本页状态，不调用后端。</template>
    <template #description>业务规则见 docs/spec/{{ spec }}.md。界面文案暂只有中文，正式实现时补齐八种语言。</template>
  </Alert>
</template>
