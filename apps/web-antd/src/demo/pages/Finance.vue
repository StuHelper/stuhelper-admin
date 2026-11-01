<script setup lang="ts">
import { reactive, ref } from 'vue';

import { Button, Drawer, Input, message, Segmented, Statistic, Table, Tag } from 'ant-design-vue';

import AdminPage from '#/shared/ui/AdminPage.vue';

const tab = ref('refund');
const refunds = reactive([
  { id: 'f1', user: '小航同学', amount: '¥5.00', ivory: 50, order: 'o-8841', state: '待审核', at: '今天 10:21', reason: '购买后没有使用' },
  { id: 'f2', user: '航小北', amount: '¥10.00', ivory: 100, order: 'o-8712', state: '退回中', at: '昨天', reason: '重复购买' },
  { id: 'f3', user: '云上', amount: '¥28.00', ivory: 300, order: 'o-8590', state: '已完成', at: '10 月 26 日', reason: '不再需要' },
]);
const orders = [
  { id: 'o-8841', user: '小航同学', amount: '¥10.00', channel: '微信支付', state: '已支付', at: '10 月 12 日' },
  { id: 'o-8712', user: '航小北', amount: '¥10.00', channel: '支付宝', state: '退款中', at: '10 月 10 日' },
  { id: 'o-8590', user: '云上', amount: '¥28.00', channel: '微信支付', state: '已退款', at: '9 月 30 日' },
];
const open = ref<(typeof refunds)[number]>();
const note = ref('');
const colors: Record<string, string> = { 待审核: 'orange', 退回中: 'blue', 已完成: 'green', 已拒绝: 'red', 已支付: 'green', 退款中: 'blue', 已退款: 'default' };
function decide(state: string) { if (open.value) open.value.state = state; message.success(state === '已拒绝' ? '已拒绝退款' : '已通过，款项将退回原账户'); open.value = undefined; note.value = ''; }
</script>

<template>
  <AdminPage title="账务与退款" description="查看 Ivory 发放、订单和退款。每笔操作都写入账本和操作记录。">
    <div class="mb-4 grid gap-4 sm:grid-cols-3">
      <section class="demo-card"><Statistic title="本月收入" prefix="¥" :value="1284" /></section>
      <section class="demo-card"><Statistic title="待审核退款" :value="refunds.filter((r) => r.state === '待审核').length" suffix="笔" /></section>
      <section class="demo-card"><Statistic title="流通中的 Ivory" :value="48260" /></section>
    </div>
    <section class="demo-card">
      <Segmented v-model:value="tab" class="mb-3" :options="[{ value: 'refund', label: '退款' }, { value: 'order', label: '订单' }]" />
      <Table v-if="tab === 'refund'" row-key="id" size="small" :pagination="false" :data-source="refunds" :scroll="{ x: 620 }" :custom-row="(r: any) => ({ onClick: () => (open = r), style: 'cursor:pointer' })" :columns="[{ title: '用户', dataIndex: 'user' }, { title: '金额', dataIndex: 'amount' }, { title: '关联订单', dataIndex: 'order' }, { title: '状态', key: 'state' }, { title: '申请时间', dataIndex: 'at' }]">
        <template #bodyCell="{ column, record }"><template v-if="column.key === 'state'"><Tag :color="colors[record.state]">{{ record.state }}</Tag></template></template>
      </Table>
      <Table v-else row-key="id" size="small" :pagination="false" :data-source="orders" :scroll="{ x: 620 }" :columns="[{ title: '订单', dataIndex: 'id' }, { title: '用户', dataIndex: 'user' }, { title: '金额', dataIndex: 'amount' }, { title: '渠道', dataIndex: 'channel' }, { title: '状态', key: 'state' }, { title: '时间', dataIndex: 'at' }]">
        <template #bodyCell="{ column, record }"><template v-if="column.key === 'state'"><Tag :color="colors[record.state]">{{ record.state }}</Tag></template></template>
      </Table>
    </section>
    <Drawer :open="!!open" title="退款详情" width="min(440px, 100vw)" @close="open = undefined">
      <dl class="demo-facts"><dt>用户</dt><dd>{{ open?.user }}</dd><dt>金额</dt><dd>{{ open?.amount }}</dd><dt>扣回 Ivory</dt><dd>{{ open?.ivory }}</dd><dt>关联订单</dt><dd>{{ open?.order }}</dd><dt>申请原因</dt><dd>{{ open?.reason }}</dd><dt>状态</dt><dd>{{ open?.state }}</dd></dl>
      <label v-if="open?.state === '待审核'" class="demo-field mt-4">处理说明<Input.TextArea v-model:value="note" :rows="3" placeholder="拒绝时必填，用户可以看到" /></label>
      <template v-if="open?.state === '待审核'" #footer><div class="flex gap-2"><Button type="primary" @click="decide('退回中')">通过并退款</Button><Button danger :disabled="!note.trim()" @click="decide('已拒绝')">拒绝</Button></div></template>
    </Drawer>
  </AdminPage>
</template>
