<script setup lang="ts">
import { Page } from '@vben/common-ui';

import { Alert, Button, Card, Steps, TabPane, Tabs, Tag } from 'ant-design-vue';

import { useMockGrid } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

const color: Record<string, string> = { 处理中: 'processing', 已退款: 'success', 已拒绝: 'default', 在售: 'green', 已下架: 'default' };
const [PlanGrid] = useMockGrid({
  columns: [{ field: 'name', title: '套餐' }, { field: 'price', title: '价格' }, { field: 'period', title: '有效期' }, { title: '状态', slots: { default: 'state' } }],
  data: [
    { name: '月度会员', price: '¥ 9.90', period: '30 天', state: '在售' },
    { name: '学期会员', price: '¥ 39.00', period: '150 天', state: '在售' },
    { name: '年度会员', price: '¥ 69.00', period: '365 天', state: '已下架' },
  ],
});
const [RewardGrid] = useMockGrid({
  columns: [{ field: 'rule', title: '行为' }, { field: 'amount', title: '奖励' }, { field: 'limit', title: '限制' }],
  data: [
    { rule: '发布有效评价', amount: '+5 积分', limit: '每日 3 次' },
    { rule: '评价被认定为优质', amount: '+50 积分', limit: '每条 1 次，撤销时追回' },
    { rule: '上传资料被下载', amount: '+1 Ivory', limit: '每份每人 1 次' },
  ],
});
const [RefundGrid] = useMockGrid({
  columns: [
    { type: 'expand', width: 48, slots: { content: 'expand' } },
    { field: 'id', title: '编号' }, { field: 'user', title: '用户' }, { field: 'item', title: '项目', minWidth: 200 }, { field: 'amount', title: '金额' },
    { title: '状态', slots: { default: 'state' } }, { field: 'at', title: '申请日期' }, { title: '操作', width: 80, slots: { default: 'action' } },
  ],
  data: [
    { id: 'rf-201', user: 'u-55302', item: '资料《操作系统复习笔记》', amount: '¥ 3.00', state: '处理中', at: '11-01' },
    { id: 'rf-198', user: 'u-71840', item: '学期会员', amount: '¥ 39.00', state: '已退款', at: '10-28' },
    { id: 'rf-190', user: 'u-60011', item: '资料《线代真题》', amount: '¥ 2.00', state: '已拒绝', at: '10-25' },
  ],
});
</script>

<template>
  <Page title="账务" description="会员、奖励、价格与退款由私有账务模块管理。公开后台只展示服务返回的结果。">
    <PrototypeNote spec="wallet-and-points" />
    <Alert type="info" show-icon class="mb-4" message="账务查询与资金操作是独立的敏感权限。能查看退款不代表能执行退款。" />
    <Card :bordered="false">
      <Tabs>
        <TabPane key="plans" tab="会员套餐与价格">
          <PlanGrid><template #state="{ row }"><Tag :color="color[row.state]">{{ row.state }}</Tag></template></PlanGrid>
        </TabPane>
        <TabPane key="rewards" tab="奖励规则"><RewardGrid /></TabPane>
        <TabPane key="refunds" tab="退款申请">
          <RefundGrid>
            <template #state="{ row }"><Tag :color="color[row.state]">{{ row.state }}</Tag></template>
            <template #action="{ row }"><Button v-if="row.state === '处理中'" type="link" size="small">处理</Button></template>
            <template #expand>
              <Steps class="px-6 py-3" size="small" :current="1" :items="[{ title: '已提交' }, { title: '处理中' }, { title: '退款到账或拒绝' }]" />
            </template>
          </RefundGrid>
        </TabPane>
      </Tabs>
    </Card>
  </Page>
</template>
