<script setup lang="ts">
import { Page } from '@vben/common-ui';

import { Card, Col, Progress, Row, Statistic, Tag } from 'ant-design-vue';

import { useMockGrid } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

const [CategoryGrid] = useMockGrid({
  columns: [{ field: 'data', title: '数据', minWidth: 200 }, { field: 'keep', title: '默认保留', minWidth: 160 }, { field: 'owner', title: '负责模块' }, { field: 'next', title: '下次执行' }, { title: '积压', slots: { default: 'backlog' } }],
  data: [
    { data: '学生认证原始材料', keep: '审核结束后 30 天', owner: 'verification', next: '11-03 02:00', backlog: 0 },
    { data: '撤回重编草稿及整条讨论', keep: '撤回后 24 小时', owner: 'reviews', next: '每小时', backlog: 2 },
    { data: '上传临时对象', keep: '24 小时内未引用即清理', owner: 'media', next: '每小时', backlog: 0 },
    { data: '群消息处理证据', keep: '默认 30 天', owner: '群聊管理', next: '11-03 03:00', backlog: 0 },
    { data: '敏感字段查看与管理审计', keep: '默认 12 个月', owner: 'platform', next: '每日', backlog: 0 },
    { data: '导出文件', keep: '24 小时', owner: '信息查询', next: '每小时', backlog: 0 },
    { data: '幂等响应', keep: '完成后 24 小时', owner: '各模块', next: '每小时', backlog: 0 },
    { data: '订单、账本与权益依据', keep: '至少 3 年', owner: 'billing', next: '—', backlog: 0 },
    { data: '常规备份', keep: '最长 30 天', owner: 'ops', next: '每日', backlog: 0 },
  ],
});
const [HoldGrid] = useMockGrid({
  columns: [{ field: 'id', title: '编号' }, { field: 'scope', title: '范围', minWidth: 220 }, { field: 'basis', title: '依据' }, { field: 'until', title: '结束条件' }, { field: 'review', title: '复核日期' }],
  data: [{ id: 'hold-3', scope: '用户 u-55302 的退款相关记录', basis: '退款争议处理中', until: '争议结束', review: '2026-12-01' }],
});
</script>

<template>
  <Page title="数据留存" description="查看各类数据的保存期限、负责模块和删除任务状态。">
    <PrototypeNote spec="data-retention" />
    <Row :gutter="16" class="mb-4">
      <Col :span="6"><Card :bordered="false"><Statistic title="删除任务积压" :value="2" /></Card></Col>
      <Col :span="6"><Card :bordered="false"><Statistic title="近 24 小时失败" :value="1" :value-style="{ color: 'hsl(var(--destructive))' }" /></Card></Col>
      <Col :span="6"><Card :bordered="false"><Statistic title="最早到期" value="11-02 11:00" /></Card></Col>
      <Col :span="6"><Card :bordered="false"><div class="text-muted-foreground mb-1 text-sm">本月清理完成率</div><Progress :percent="99.7" size="small" /></Card></Col>
    </Row>
    <Card :bordered="false" title="保存期限">
      <CategoryGrid><template #backlog="{ row }"><Tag :color="row.backlog ? 'orange' : 'green'">{{ row.backlog ? `${row.backlog} 项` : '无' }}</Tag></template></CategoryGrid>
    </Card>
    <Card :bordered="false" title="法律或争议保留" class="mt-4"><HoldGrid /></Card>
  </Page>
</template>
