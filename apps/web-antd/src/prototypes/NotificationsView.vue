<script setup lang="ts">
import { reactive } from 'vue';

import { Page } from '@vben/common-ui';

import { Card, Col, Row, Statistic, Switch, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';

import { useMockGrid } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

const [ConfigForm] = useVbenForm({
  commonConfig: { componentProps: { class: 'w-full' } },
  layout: 'vertical',
  schema: [
    { component: 'InputNumber', fieldName: 'retainDays', label: '通知保留期限（天）', defaultValue: 180, componentProps: { min: 7 } },
    { component: 'InputNumber', fieldName: 'aggregateMinutes', label: '互动通知聚合窗口（分钟）', defaultValue: 30, description: '窗口内同一内容的多次点赞合并为一条', componentProps: { min: 1 } },
    { component: 'InputNumber', fieldName: 'remindHours', label: '提醒提前量（小时）', defaultValue: 24, description: '例如宽限期或草稿到期前提醒', componentProps: { min: 1 } },
  ],
  actionPosition: 'left',
  resetButtonOptions: { show: false },
  submitButtonOptions: { content: '保存' },
});
const [ChannelGrid] = useMockGrid({
  columns: [{ field: 'name', title: '渠道' }, { title: '状态', slots: { default: 'state' } }, { field: 'note', title: '说明', minWidth: 160 }],
  data: [
    { name: '站内通知', state: '已接入', note: '始终开启' },
    { name: '邮件', state: '已接入', note: '用户选择后发送' },
    { name: 'QQ 私聊', state: '未接入', note: '机器人能力待接入，不向用户显示' },
    { name: '客户端推送', state: '未接入', note: '原生端搁置' },
  ],
});
// Rows are reactive so the switches inside grid cells update the same mock records.
const [TypeGrid] = useMockGrid({
  columns: [
    { field: 'source', title: '来源', width: 100 }, { field: 'example', title: '内容', minWidth: 220 },
    { title: '默认开启', width: 90, slots: { default: 'on' } }, { title: '用户可关闭', width: 100, slots: { default: 'optional' } }, { title: '聚合', width: 80, slots: { default: 'aggregate' } },
  ],
  data: reactive([
    { source: '内容互动', example: '本人内容收到回复、点赞', defaultOn: true, optional: true, aggregate: true },
    { source: '内容管理', example: '内容处理结果、资料下架申请结果', defaultOn: true, optional: false, aggregate: false },
    { source: '举报', example: '本人举报的处理结果', defaultOn: true, optional: false, aggregate: false },
    { source: '认证', example: '学生认证结果、撤销与删除申请结果', defaultOn: true, optional: false, aggregate: false },
    { source: '系统', example: '与用户有关的系统通知', defaultOn: true, optional: false, aggregate: false },
  ]),
});
</script>

<template>
  <Page title="通知设置" description="配置站内通知的保留、聚合和提醒，以及各类通知的默认行为。未接入的渠道不对用户显示。">
    <PrototypeNote spec="notifications" />
    <Row :gutter="16" class="mb-4">
      <Col :span="8"><Card :bordered="false"><Statistic title="近 7 天发送" :value="12408" /></Card></Col>
      <Col :span="8"><Card :bordered="false"><Statistic title="未读率" :value="38.2" suffix="%" /></Card></Col>
      <Col :span="8"><Card :bordered="false"><Statistic title="外部投递失败" :value="17" :value-style="{ color: 'hsl(var(--destructive))' }" /></Card></Col>
    </Row>
    <Row :gutter="16">
      <Col :xs="24" :lg="9">
        <Card :bordered="false" title="全局参数"><ConfigForm /></Card>
        <Card :bordered="false" title="发送渠道" class="mt-4">
          <ChannelGrid><template #state="{ row }"><Tag :color="row.state === '已接入' ? 'success' : 'default'">{{ row.state }}</Tag></template></ChannelGrid>
        </Card>
      </Col>
      <Col :xs="24" :lg="15">
        <Card :bordered="false" title="通知类型">
          <TypeGrid>
            <template #on="{ row }"><Switch v-model:checked="row.defaultOn" size="small" :disabled="!row.optional" /></template>
            <template #optional="{ row }"><Tag :color="row.optional ? 'blue' : 'default'">{{ row.optional ? '可关闭' : '必须接收' }}</Tag></template>
            <template #aggregate="{ row }"><Switch v-model:checked="row.aggregate" size="small" :disabled="!row.optional" /></template>
          </TypeGrid>
          <p class="text-muted-foreground mt-3 text-sm">业务处理、安全与账号通知默认开启且不可关闭。免打扰只延后外部推送，站内通知仍可查看。</p>
        </Card>
      </Col>
    </Row>
  </Page>
</template>
