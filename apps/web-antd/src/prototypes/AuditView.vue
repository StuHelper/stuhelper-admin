<script setup lang="ts">
import { Page } from '@vben/common-ui';

import { Card, Descriptions, DescriptionsItem, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { mockQuery } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

type Operation = { action: string; after: string; at: string; before: string; id: string; module: string; operator: string; reason: string; result: string; target: string };
const rows: Operation[] = [
  { id: 'op-9012', at: '2026-11-02 10:42', operator: '王**（学校管理员）', module: '评价审核', action: '隐藏评价', target: '评价 e3 · 高等数学 A', result: '成功', reason: '包含人身攻击内容', before: '已公开', after: '已隐藏' },
  { id: 'op-9011', at: '2026-11-02 10:15', operator: '刘**（内容审核）', module: '评价审核', action: '批量处置（12 项）', target: '待办 12 项', result: '部分失败', reason: '广告批量清理', before: '待处理', after: '11 项已执行，1 项版本冲突' },
  { id: 'op-9010', at: '2026-11-01 21:03', operator: '赵**（平台管理员）', module: '动作资格', action: '修改规则', target: '发布课程评价 · 示例大学', result: '成功', reason: '新生开学，放宽手机号要求', before: '登录、学生认证、已绑定手机号、选课', after: '登录、学生认证、选课' },
  { id: 'op-9009', at: '2026-11-01 16:30', operator: '赵**（平台管理员）', module: '信息查询', action: '查看完整身份字段', target: '用户 u-55302', result: '成功', reason: '处理退款争议', before: '', after: '' },
  { id: 'op-9008', at: '2026-11-01 09:12', operator: '何**（学校管理员）', module: '学生认证', action: '拒绝认证申请', target: '申请 a17', result: '成功', reason: '材料与学号不一致', before: '待审核', after: '已拒绝' },
  { id: 'op-9007', at: '2026-10-31 18:40', operator: '陈**（群管理）', module: '群聊管理', action: '禁言', target: '群 示例大学 2026 新生群 · 成员 Q****21', result: '失败', reason: '刷屏', before: '', after: '机器人离线，未执行' },
];
const color = (r: string) => ({ 成功: 'success', 失败: 'error', 部分失败: 'warning' })[r] ?? 'default';
const matches = (r: Operation, form: Record<string, any>) => (!form.module || r.module === form.module)
  && (!form.keyword || JSON.stringify(r).includes(form.keyword))
  && (!form.from || r.at.slice(0, 10) >= form.from) && (!form.to || r.at.slice(0, 10) <= form.to);

const [Grid] = useVbenVxeGrid<Operation>({
  formOptions: {
    fieldMappingTime: [['range', ['from', 'to'], 'YYYY-MM-DD']],
    schema: [
      { component: 'Input', fieldName: 'keyword', label: '关键词', componentProps: { allowClear: true, placeholder: '搜索操作者、对象或原因' } },
      { component: 'Select', fieldName: 'module', label: '模块', componentProps: { allowClear: true, placeholder: '全部模块', options: ['评价审核', '动作资格', '信息查询', '学生认证', '群聊管理'].map((value) => ({ label: value, value })) } },
      { component: 'RangePicker', fieldName: 'range', label: '时间' },
    ],
  },
  gridOptions: {
    columns: [
      { type: 'expand', width: 48, slots: { content: 'expand' } },
      { field: 'at', title: '时间', width: 150 }, { field: 'operator', title: '操作者', width: 170 }, { field: 'module', title: '模块', width: 100 },
      { field: 'action', title: '操作', minWidth: 150 }, { field: 'target', title: '对象', minWidth: 200 }, { title: '结果', width: 100, slots: { default: 'result' } },
    ],
    proxyConfig: mockQuery(rows, matches),
    rowConfig: { keyField: 'id' },
  },
});
</script>

<template>
  <Page title="操作记录" description="在获准范围查看管理操作的对象、操作者、时间、原因与结果。查看权不包含修改权。">
    <PrototypeNote spec="admin-operations" />
    <Card :bordered="false">
      <Grid>
        <template #result="{ row }"><Tag :color="color(row.result)">{{ row.result }}</Tag></template>
        <template #expand="{ row }">
          <Descriptions class="!px-4 !py-2" :column="{ xs: 1, md: 3 }" size="small">
            <DescriptionsItem label="记录编号">{{ row.id }}</DescriptionsItem>
            <DescriptionsItem label="原因">{{ row.reason }}</DescriptionsItem>
            <DescriptionsItem label="变化">{{ row.before ? `${row.before} → ${row.after}` : '无内容变化（查看类操作）' }}</DescriptionsItem>
          </Descriptions>
        </template>
      </Grid>
    </Card>
  </Page>
</template>
