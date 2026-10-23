<script setup lang="ts">
import { RouterLink } from 'vue-router';

import { Result } from 'ant-design-vue';
</script>

<template>
  <Result status="404" title="页面暂不可用" sub-title="地址可能有误，或对应功能尚未开放。">
    <template #extra><RouterLink to="/">返回工作台</RouterLink></template>
  </Result>
</template>
