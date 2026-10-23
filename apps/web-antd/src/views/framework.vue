<script setup lang="ts">
import { computed } from 'vue';

import { Page } from '@vben/common-ui';

import { Alert, Button, Card } from 'ant-design-vue';

import { usePlatform } from '#/composables/usePlatform';

const { state, error, reload } = usePlatform({ admin: true });
const description = computed(() => {
  if (state.value === 'loading') return '正在连接管理服务…';
  if (state.value === 'ready') return '管理服务已连接。';
  switch (error.value) {
    case 'forbidden': { return '当前账号没有访问管理工作台的权限。';
    }
    case 'identity': { return '管理员身份服务尚未接入。';
    }
    case 'incompatible': { return '服务版本暂不兼容，请更新后重试。';
    }
    case 'unauthenticated': { return '请先登录后访问管理工作台。';
    }
    default: { return '暂时无法连接管理服务，请稍后重试。';
    }
  }
});
</script>

<template>
  <Page title="管理工作台" description="当前为开发预览，管理功能尚未开放。">
    <Card title="服务状态" :bordered="false">
      <div role="status" aria-live="polite">
        <Alert :message="description" :type="state === 'ready' ? 'success' : 'info'" show-icon />
      </div>
      <Button class="mt-4" :loading="state === 'loading'" @click="reload">重新连接</Button>
    </Card>
  </Page>
</template>
