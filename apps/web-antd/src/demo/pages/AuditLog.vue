<script setup lang="ts">
import { computed, ref } from 'vue';

import { Drawer, Input, Select, Table, Tag } from 'ant-design-vue';

import AdminPage from '#/shared/ui/AdminPage.vue';

const q = ref('');
const kind = ref('');
const detail = ref<Record<string, any>>();
const logs = [
  { id: 'l1', at: '2026-10-30 18:12', who: '运营值班', action: '查看敏感字段', target: '用户 u-2048 手机号', result: '成功', kind: '查询', reason: '工单 2041 需要联系本人' },
  { id: 'l2', at: '2026-10-30 16:40', who: '航小北', action: '隐藏评价', target: '评价 r13', result: '成功', kind: '审核', reason: '人身攻击' },
  { id: 'l3', at: '2026-10-30 11:05', who: '不周山', action: '通过学生认证', target: '申请 a4', result: '成功', kind: '认证', reason: '材料清晰有效' },
  { id: 'l4', at: '2026-10-29 21:32', who: '运营值班', action: '修改角色权限', target: '角色 内容审核员', result: '成功', kind: '权限', reason: '增加资料审核' },
  { id: 'l5', at: '2026-10-29 15:18', who: '财务专员', action: '处理退款', target: '退款 f1', result: '失败', kind: '账务', reason: '支付渠道暂不可用' },
];
const rows = computed(() => logs.filter((l) => (!kind.value || l.kind === kind.value) && (!q.value.trim() || `${l.who}${l.target}${l.action}`.includes(q.value.trim()))));
</script>

<template>
  <AdminPage title="操作记录" description="记录管理操作的操作者、对象、结果和原因。记录只能查看，不能修改。">
    <section class="demo-card">
      <div class="mb-3 flex flex-wrap gap-2">
        <Input v-model:value="q" class="flex-1 min-w-48" placeholder="搜索操作者、对象或操作" allow-clear aria-label="搜索操作记录" />
        <Select v-model:value="kind" class="w-32" aria-label="分类" :options="[{ value: '', label: '全部分类' }, ...['查询', '审核', '认证', '权限', '账务'].map((v) => ({ value: v, label: v }))]" />
      </div>
      <Table row-key="id" size="small" :data-source="rows" :pagination="{ pageSize: 20, hideOnSinglePage: true }" :scroll="{ x: 720 }" :custom-row="(r: any) => ({ onClick: () => (detail = r), style: 'cursor:pointer' })" :columns="[{ title: '时间', dataIndex: 'at', width: 150 }, { title: '操作者', dataIndex: 'who' }, { title: '操作', dataIndex: 'action' }, { title: '对象', dataIndex: 'target' }, { title: '结果', key: 'result', width: 80 }]">
        <template #bodyCell="{ column, record }"><template v-if="column.key === 'result'"><Tag :color="record.result === '成功' ? 'green' : 'red'">{{ record.result }}</Tag></template></template>
      </Table>
    </section>
    <Drawer :open="!!detail" title="记录详情" width="min(420px, 100vw)" @close="detail = undefined">
      <dl class="demo-facts"><dt>时间</dt><dd>{{ detail?.at }}</dd><dt>操作者</dt><dd>{{ detail?.who }}</dd><dt>操作</dt><dd>{{ detail?.action }}</dd><dt>对象</dt><dd>{{ detail?.target }}</dd><dt>结果</dt><dd>{{ detail?.result }}</dd><dt>原因</dt><dd>{{ detail?.reason }}</dd></dl>
    </Drawer>
  </AdminPage>
</template>
