<script setup lang="ts">
import { ref, watchEffect } from 'vue';

import { Page, useVbenModal } from '@vben/common-ui';

import { Alert, Button, Card, Col, Descriptions, DescriptionsItem, Empty, Input, List, ListItem, Row, Tag, Timeline, TimelineItem } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';

import { useMockGrid } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

const searched = ref(true);
const candidates = [
  { id: 'u-55302', label: '张*（示例大学 · 计算机学院 · 2026 级）', hint: '学号 2026****01 · QQ 已绑定' },
  { id: 'u-71840', label: '张*（演示理工学院 · 数学学院 · 2024 级）', hint: '学号 2024****77 · 未绑定 QQ' },
];
const picked = ref('u-55302');
const revealed = ref(false);
const purpose = ref('');

const [SearchForm] = useVbenForm({
  actionLayout: 'inline',
  commonConfig: { hideLabel: true },
  layout: 'horizontal',
  wrapperClass: 'grid-cols-1 md:grid-cols-[8rem_20rem_auto]',
  schema: [
    { component: 'Select', fieldName: 'by', defaultValue: 'name', componentProps: { options: [{ value: 'id', label: '学号' }, { value: 'name', label: '姓名' }, { value: 'qq', label: 'QQ' }] } },
    { component: 'Input', fieldName: 'keyword', defaultValue: '张同学', componentProps: { placeholder: '输入线索' } },
  ],
  handleSubmit: () => { searched.value = true; },
  resetButtonOptions: { show: false },
  submitButtonOptions: { content: '查询' },
});
const [GroupGrid] = useMockGrid({
  columns: [{ field: 'g', title: '群' }, { field: 's', title: '资格处理' }],
  data: [{ g: '2026 新生群', s: '正常' }, { g: '计算机学院交流群', s: '已恢复' }],
});
const [RevealModal, revealModal] = useVbenModal({
  title: '查看完整身份字段',
  confirmText: '记录并查看',
  onConfirm: () => { revealed.value = true; revealModal.close(); },
});
watchEffect(() => revealModal.setState({ confirmDisabled: !purpose.value.trim() }));
const [ExportModal, exportModal] = useVbenModal({ title: '导出预览', confirmText: '生成文件', onConfirm: () => exportModal.close() });
</script>

<template>
  <Page title="信息查询" description="按学号、姓名或 QQ 查找对象，按业务域查看关联记录。每个业务域分别按你的权限决定是否可见。">
    <PrototypeNote spec="information-query" />
    <Card :bordered="false" class="mb-4">
      <div class="flex flex-wrap items-start gap-2">
        <SearchForm />
        <Button @click="exportModal.open()">批量查询与导出</Button>
      </div>
    </Card>
    <Row v-if="searched" :gutter="16">
      <Col :xs="24" :lg="7">
        <Card :bordered="false" title="候选对象">
          <Alert type="info" show-icon class="mb-3" message="姓名有重名，请选择具体对象。系统不会把重名记录合并成一人。" />
          <List :data-source="candidates" size="small">
            <template #renderItem="{ item }">
              <ListItem class="cursor-pointer rounded px-2" :class="{ 'bg-accent': item.id === picked }" @click="picked = item.id">
                <div><div>{{ item.label }}</div><div class="text-muted-foreground text-xs">{{ item.hint }}</div></div>
              </ListItem>
            </template>
          </List>
        </Card>
      </Col>
      <Col :xs="24" :lg="17">
        <Row :gutter="[16, 16]">
          <Col :xs="24" :xl="12">
            <Card :bordered="false" title="身份与认证" size="small">
              <template #extra><Button v-if="!revealed" size="small" danger @click="revealModal.open()">查看完整字段</Button><Tag v-else color="red">已展开 · 已记审计</Tag></template>
              <Descriptions :column="1" size="small">
                <DescriptionsItem label="姓名">{{ revealed ? '张晓明' : '张*' }}</DescriptionsItem>
                <DescriptionsItem label="学号">{{ revealed ? '20260101' : '2026****01' }}</DescriptionsItem>
                <DescriptionsItem label="学校">示例大学 · 计算机学院</DescriptionsItem>
                <DescriptionsItem label="学生认证"><Tag color="green">有效校园资格</Tag></DescriptionsItem>
                <DescriptionsItem label="QQ">{{ revealed ? '3301021' : 'Q****1021' }}（2026-09-02 绑定）</DescriptionsItem>
              </Descriptions>
            </Card>
          </Col>
          <Col :xs="24" :xl="12">
            <Card :bordered="false" title="内容" size="small">
              <Timeline>
                <TimelineItem color="green">发布评价《操作系统：作业量大但收获很多》· 已公开</TimelineItem>
                <TimelineItem color="red">评价《高等数学 A 课堂体验》被隐藏 · 举报处理</TimelineItem>
                <TimelineItem>上传资料《操作系统复习笔记》· 已发布</TimelineItem>
              </Timeline>
            </Card>
          </Col>
          <Col :xs="24" :xl="12">
            <Card :bordered="false" title="群聊" size="small"><GroupGrid /></Card>
          </Col>
          <Col :xs="24" :xl="12">
            <Card :bordered="false" title="积分、Ivory 与退款" size="small">
              <div class="py-6 text-center"><Tag color="default">无权查看</Tag><p class="text-muted-foreground mt-2 text-sm">你的角色没有账务查询权，不能通过其他关联线索查看此业务域。</p></div>
            </Card>
          </Col>
        </Row>
      </Col>
    </Row>
    <Empty v-else description="输入线索开始查询" />
    <RevealModal>
      <p class="mb-2">本次查看会记录操作者、对象、字段类别和用途。审计服务不可用时不会返回完整字段。</p>
      <Input.TextArea v-model:value="purpose" :rows="3" placeholder="填写查看用途" />
    </RevealModal>
    <ExportModal>
      <p>对象范围：示例大学 2026 级，共 1,832 人。</p>
      <p>将导出：学校、院系、认证状态、QQ 绑定状态（掩码）。</p>
      <p class="text-muted-foreground">账务数据域未获授权，不会进入文件。文件 24 小时后过期。</p>
    </ExportModal>
  </Page>
</template>
