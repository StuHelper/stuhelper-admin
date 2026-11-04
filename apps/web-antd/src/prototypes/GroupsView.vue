<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import { Page, useVbenModal } from '@vben/common-ui';

import { Alert, Button, Card, Col, Descriptions, DescriptionsItem, List, ListItem, Radio, RadioGroup, Row, Space, Statistic, TabPane, Tabs, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { mockQuery, useMockGrid } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

const groupList = [
  { id: 'g1', name: '示例大学 2026 新生群', members: 1832, pending: 14, mode: '先认证后入群' },
  { id: 'g2', name: '示例大学计算机学院交流群', members: 640, pending: 3, mode: '先入群禁言，限时认证' },
  { id: 'g3', name: '示例大学二手交易群', members: 2410, pending: 0, mode: '公告动态口令' },
];
const current = ref('g1');
const group = computed(() => groupList.find((g) => g.id === current.value)!);
const stageColor: Record<string, string> = { 已提醒: 'gold', 宽限期内: 'orange', 已恢复: 'green', 已延长: 'blue', 已豁免: 'purple', 已移出: 'red', 正常: 'default' };
type Member = { card: string; deadline?: string; nick: string; qq: string; stage: string; status: string };
const members = reactive<Member[]>([
  { qq: 'Q****1021', nick: '计科-26-张*', status: '有效校园资格', stage: '正常', card: '合规' },
  { qq: 'Q****3307', nick: '小王', status: '资格已失效', stage: '宽限期内', card: '不合规：缺少院系', deadline: '2026-11-09' },
  { qq: 'Q****5512', nick: '数学-25-李*', status: '资格已失效', stage: '已提醒', card: '合规', deadline: '2026-11-15' },
  { qq: 'Q****7781', nick: '外院-24-陈*', status: '已认证校友', stage: '已豁免', card: '合规' },
  { qq: 'Q****9020', nick: '路人甲', status: '未认证', stage: '已移出', card: '资料未就绪（不计违规）' },
  { qq: 'Q****6634', nick: '计科-26-周*', status: '有效校园资格', stage: '已恢复', card: '合规' },
]);
const reportColor: Record<string, string> = { 建议: 'blue', 待执行: 'orange', 已执行: 'green' };
const graceStages = new Set(['宽限期内', '已提醒']);
function extend(row: Member) { row.stage = '已延长'; row.deadline = '2026-11-23'; }
function exempt(row: Member) { row.stage = '已豁免'; }

const [MemberGrid] = useVbenVxeGrid<Member>({
  formOptions: {
    submitOnChange: true,
    schema: [
      { component: 'Input', fieldName: 'keyword', label: '成员', componentProps: { allowClear: true, placeholder: 'QQ 或群名片' } },
      { component: 'Select', fieldName: 'stage', label: '处理阶段', componentProps: { allowClear: true, options: Object.keys(stageColor).map((value) => ({ label: value, value })) } },
    ],
  },
  gridOptions: {
    columns: [
      { field: 'qq', title: '成员' }, { field: 'nick', title: '群名片' }, { field: 'status', title: '学生资格' }, { field: 'card', title: '名片检查', minWidth: 160 },
      { title: '处理阶段', minWidth: 120, slots: { default: 'stage' } }, { title: '操作', width: 120, fixed: 'right', slots: { default: 'action' } },
    ],
    pagerConfig: { enabled: false },
    proxyConfig: mockQuery(members, (m, form) => (!form.stage || m.stage === form.stage) && (!form.keyword || `${m.qq}${m.nick}`.includes(form.keyword))),
    showOverflow: false,
    toolbarConfig: { refresh: false },
  },
});
const [ApplicationGrid] = useMockGrid({
  columns: [{ field: 'qq', title: '申请人' }, { field: 'at', title: '时间' }, { field: 'need', title: '群要求' }, { field: 'progress', title: '进度' }, { field: 'next', title: '下一步' }],
  data: [
    { qq: 'Q****8812', at: '11-02 09:10', need: '有效校园资格', progress: '等待认证', next: '已引导到学生认证' },
    { qq: 'Q****4410', at: '11-02 08:55', need: '有效校园资格', progress: '已满足', next: '待机器人批准入群' },
    { qq: 'Q****2297', at: '11-01 22:31', need: '有效校园资格', progress: '认证被拒', next: '已通知申请人' },
  ],
});
const [ReportGrid] = useMockGrid({
  columns: [{ field: 'target', title: '被举报成员' }, { field: 'reason', title: '举报原因' }, { field: 'ai', title: 'AI 分析与建议', minWidth: 280 }, { title: '状态', slots: { default: 'state' } }, { title: '操作', width: 120, slots: { default: 'action' } }],
  data: [
    { id: 'rp1', target: 'Q****3307', reason: '连续发送广告链接', ai: '建议：撤回并禁言 1 小时（命中广告规则 3 次）', state: '建议', confidence: 0.92 },
    { id: 'rp2', target: 'Q****5120', reason: '辱骂其他成员', ai: '建议：警告；如再次出现建议踢出（需管理员确认）', state: '待执行', confidence: 0.81 },
    { id: 'rp3', target: 'Q****7004', reason: '刷屏', ai: '已自动撤回 5 条并禁言 10 分钟', state: '已执行', confidence: 0.97 },
  ],
  showOverflow: false,
});

const [CardForm] = useVbenForm({
  layout: 'vertical',
  wrapperClass: 'max-w-xl',
  schema: [
    { component: 'Input', fieldName: 'template', label: '名片模板', defaultValue: '{院系}-{年级}-{姓名}', description: '可引用学校、年级、院系、姓名、学号、性别字段，并保留自由昵称' },
    { component: 'Switch', fieldName: 'check', label: '检查名片', defaultValue: true },
    { component: 'Switch', fieldName: 'remind', label: '不合规时提醒', defaultValue: true },
    { component: 'Switch', fieldName: 'autoFix', label: '自动修改名片', defaultValue: false },
    { component: 'Switch', fieldName: 'kick', label: '不合规自动踢出', defaultValue: false },
  ],
  showDefaultActions: false,
});
const [RuleForm] = useVbenForm({
  commonConfig: { componentProps: { class: 'w-full', min: 0 } },
  layout: 'vertical',
  wrapperClass: 'grid-cols-1 md:grid-cols-3 max-w-3xl',
  schema: [
    { component: 'Textarea', fieldName: 'keywords', label: '关键词（每行一个）', defaultValue: '代写\n刷单\n加微信', formItemClass: 'md:col-span-3', componentProps: { rows: 4 } },
    { component: 'InputNumber', fieldName: 'repeat', label: '重复消息阈值（条）', defaultValue: 3, componentProps: { min: 2 } },
    { component: 'InputNumber', fieldName: 'window', label: '检测窗口（秒）', defaultValue: 60, componentProps: { min: 10 } },
    { component: 'InputNumber', fieldName: 'warnLimit', label: '警告累计上限', defaultValue: 3, componentProps: { min: 1 } },
    { component: 'InputNumber', fieldName: 'muteMinutes', label: '禁言时长（分钟）', defaultValue: 30, componentProps: { min: 1 } },
    { component: 'InputNumber', fieldName: 'recallKeep', label: '撤回消息留存（天）', defaultValue: 30 },
  ],
  actionLayout: 'newLine',
  actionPosition: 'left',
  resetButtonOptions: { show: false },
  submitButtonOptions: { content: '保存群规则' },
});
const [BatchModal, batchModal] = useVbenModal({ title: '批量处置预览', confirmText: '确认执行', onConfirm: () => batchModal.close() });
</script>

<template>
  <Page title="群聊管理" description="查看获准群的成员资格、入群申请和群规则。界面区分建议、待执行与实际执行结果。">
    <PrototypeNote spec="qq-group-services" />
    <Row :gutter="16">
      <Col :xs="24" :lg="6">
        <Card :bordered="false" title="获准管理的群">
          <List :data-source="groupList" size="small">
            <template #renderItem="{ item }">
              <ListItem class="cursor-pointer rounded px-2" :class="{ 'bg-accent': item.id === current }" @click="current = item.id">
                <div><div class="font-medium">{{ item.name }}</div><div class="text-muted-foreground text-xs">{{ item.members }} 人 · {{ item.mode }}</div></div>
                <Tag v-if="item.pending" color="orange">{{ item.pending }}</Tag>
              </ListItem>
            </template>
          </List>
        </Card>
      </Col>
      <Col :xs="24" :lg="18">
        <Card :bordered="false">
          <Row :gutter="16" class="mb-2">
            <Col :span="6"><Statistic title="成员" :value="group.members" /></Col>
            <Col :span="6"><Statistic title="宽限期内" :value="23" /></Col>
            <Col :span="6"><Statistic title="待处理入群" :value="group.pending" /></Col>
            <Col :span="6"><Statistic title="今日命中规则" :value="41" /></Col>
          </Row>
          <Tabs>
            <TabPane key="members" tab="成员与资格">
              <MemberGrid>
                <template #toolbar-actions><Button @click="batchModal.open()">批量处置</Button></template>
                <template #stage="{ row }"><Tag :color="stageColor[row.stage]">{{ row.stage }}</Tag><div v-if="row.deadline && ['宽限期内', '已提醒', '已延长'].includes(row.stage)" class="text-muted-foreground text-xs">截止 {{ row.deadline }}</div></template>
                <template #action="{ row }">
                  <Space v-if="graceStages.has(row.stage)" :size="0"><Button type="link" size="small" @click="extend(row)">延长</Button><Button type="link" size="small" @click="exempt(row)">豁免</Button></Space>
                </template>
              </MemberGrid>
            </TabPane>
            <TabPane key="join" tab="入群申请">
              <Descriptions size="small" class="mb-3"><DescriptionsItem label="入群方式">{{ group.mode }}</DescriptionsItem><DescriptionsItem label="接受校友">否</DescriptionsItem><DescriptionsItem label="接受临时新生">是</DescriptionsItem></Descriptions>
              <ApplicationGrid />
            </TabPane>
            <TabPane key="card" tab="群名片规则">
              <CardForm />
              <Alert type="info" show-icon message="名片不合规与学生资格失效是两种原因。资格失效的自动移出规则不会扩展到名片不合规。" />
            </TabPane>
            <TabPane key="rules" tab="关键词与防复读">
              <RuleForm />
            </TabPane>
            <TabPane key="reports" tab="举报与 AI 分析">
              <ReportGrid>
                <template #state="{ row }"><Tag :color="reportColor[row.state]">{{ row.state }}</Tag></template>
                <template #action="{ row }">
                  <Space v-if="row.state !== '已执行'" :size="0"><Button type="link" size="small">采纳</Button><Button type="link" size="small">驳回</Button></Space>
                </template>
              </ReportGrid>
            </TabPane>
          </Tabs>
        </Card>
      </Col>
    </Row>
    <BatchModal>
      <RadioGroup class="mb-3" value="remind"><Radio value="remind">提醒补认证</Radio><Radio value="extend">延长宽限期 7 天</Radio><Radio value="remove">移出群</Radio></RadioGroup>
      <p>将处理 2 名成员：Q****3307、Q****5512。执行后逐人显示成功或失败。</p>
    </BatchModal>
  </Page>
</template>
