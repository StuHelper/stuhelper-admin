<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import { Button, Drawer, Input, message, Segmented, Table, Tag } from 'ant-design-vue';

import AdminPage from '#/shared/ui/AdminPage.vue';

const apps = reactive([
  { id: 'cli_c20e44', name: '评价导出工具', dev: '不周山', state: 'review', scopes: ['读取公开评价'], redirect: 'https://example.invalid/cb', users: 0, at: '今天' },
  { id: 'cli_a91b02', name: '航班式课表', dev: '云上工作室', state: 'review', scopes: ['读取我的课表', '读取基本资料'], redirect: 'https://example.invalid/oauth', users: 0, at: '昨天' },
  { id: 'cli_7f3a91', name: '航课表小组件', dev: '云上工作室', state: 'approved', scopes: ['读取我的课表', '读取基本资料'], redirect: 'https://example.invalid/callback', users: 214, at: '6 月 2 日' },
  { id: 'cli_11dd30', name: '刷课插件', dev: '匿名开发者', state: 'rejected', scopes: ['读取我的课表'], redirect: 'http://example.invalid', users: 0, at: '5 月 18 日' },
]);
const tab = ref('review');
const open = ref<(typeof apps)[number]>();
const note = ref('');
const text: Record<string, [string, string]> = { review: ['待审批', 'blue'], approved: ['已上线', 'green'], rejected: ['未通过', 'red'], suspended: ['已停用', 'orange'] };
const rows = computed(() => apps.filter((a) => tab.value === 'all' || a.state === tab.value));
function decide(state: string) { if (open.value) open.value.state = state; message.success(`已${text[state]![0]}`); open.value = undefined; note.value = ''; }
</script>

<template>
  <AdminPage title="开放平台审批" description="审批开发者应用及其申请的数据权限。">
    <section class="demo-card">
      <Segmented v-model:value="tab" class="mb-3" :options="[{ value: 'review', label: '待审批' }, { value: 'approved', label: '已上线' }, { value: 'rejected', label: '未通过' }, { value: 'all', label: '全部' }]" />
      <Table row-key="id" size="small" :pagination="false" :data-source="rows" :scroll="{ x: 640 }" :custom-row="(r: any) => ({ onClick: () => (open = r), style: 'cursor:pointer' })" :columns="[{ title: '应用', dataIndex: 'name' }, { title: '开发者', dataIndex: 'dev' }, { title: '权限', key: 'scopes' }, { title: '状态', key: 'state', width: 90 }, { title: '提交', dataIndex: 'at', width: 90 }]">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'scopes'"><Tag v-for="s in record.scopes" :key="s">{{ s }}</Tag></template>
          <template v-if="column.key === 'state'"><Tag :color="text[record.state]?.[1]">{{ text[record.state]?.[0] }}</Tag></template>
        </template>
      </Table>
    </section>
    <Drawer :open="!!open" :title="open?.name" width="min(460px, 100vw)" @close="open = undefined">
      <dl class="demo-facts"><dt>Client ID</dt><dd>{{ open?.id }}</dd><dt>开发者</dt><dd>{{ open?.dev }}</dd><dt>回调地址</dt><dd>{{ open?.redirect }}</dd><dt>授权用户</dt><dd>{{ open?.users }}</dd><dt>申请权限</dt><dd>{{ open?.scopes.join('、') }}</dd></dl>
      <label class="demo-field mt-4">审批说明<Input.TextArea v-model:value="note" :rows="3" placeholder="拒绝或停用时必填，开发者可以看到" /></label>
      <template #footer>
        <div class="flex gap-2">
          <template v-if="open?.state === 'review'"><Button type="primary" @click="decide('approved')">通过</Button><Button danger :disabled="!note.trim()" @click="decide('rejected')">拒绝</Button></template>
          <Button v-else-if="open?.state === 'approved'" danger :disabled="!note.trim()" @click="decide('suspended')">停用</Button>
        </div>
      </template>
    </Drawer>
  </AdminPage>
</template>
