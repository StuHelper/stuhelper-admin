<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';

import { Alert, Button, Card, Descriptions, DescriptionsItem, Segmented, Space, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';

import { useMockGrid } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

const conditions = [
  { value: 'guest', label: '允许游客' }, { value: 'login', label: '登录' }, { value: 'campus', label: '有效校园资格' },
  { value: 'phone', label: '手机号已绑定' }, { value: 'realname', label: '独立实名' }, { value: 'enrollment', label: '本人选课记录' },
];
const labelOf = (value: string) => conditions.find((c) => c.value === value)?.label ?? value;
type Rule = { action: string; group: string; other: string; override?: string[]; overrideRevision?: number; revision: number; site: string[] };
const rules = reactive<Rule[]>([
  { action: '查看课程和教师公开资料', group: '评价', site: ['guest'], other: '内容正常公开', revision: 1 },
  { action: '阅读完整课程评价和导师评论', group: '评价', site: ['campus'], other: '内容未被隐藏或删除', revision: 2 },
  { action: '发布课程评价', group: '评价', site: ['login', 'campus', 'phone', 'enrollment'], other: '课程和教师关联有效，符合审核规则', revision: 3, override: ['login', 'campus', 'enrollment'], overrideRevision: 1 },
  { action: '发布导师评论或回复', group: '评价', site: ['login', 'campus', 'phone'], other: '符合内容和审核规则', revision: 1 },
  { action: '点赞、点踩、收藏和举报', group: '互动', site: ['login'], other: '目标可执行该操作', revision: 1 },
  { action: '发起学生认证', group: '认证', site: ['login'], other: '选择已开放的学校与方法', revision: 1 },
  { action: '上传资料、提交更正或新版本', group: '资料', site: ['login', 'campus', 'phone'], other: '按审核规则处理', revision: 2 },
  { action: '下载公开资料', group: '资料', site: ['campus'], other: '当前资料可下载，免费', revision: 1 },
  { action: '购买受限资料', group: '资料', site: ['login', 'campus'], other: '当前可售，按选定账户和价格支付', revision: 1 },
  { action: '购买会员', group: '账务', site: ['login', 'campus'], other: '按账务服务返回的套餐办理', revision: 1 },
]);
const scope = ref<string>('site');
const editing = ref<Rule>();
const draft = ref<string[]>([]);
const reason = ref('');
const saved = ref('');
const effective = (rule: Rule) => (scope.value === 'school' && rule.override ? rule.override : rule.site);
const source = (rule: Rule) => (scope.value === 'school' && rule.override ? '示例大学覆盖' : '全站默认');

const [Grid] = useMockGrid<Rule>({
  columns: [
    { field: 'group', title: '业务', width: 80 },
    { field: 'action', title: '动作', minWidth: 200 },
    { title: '当前生效的用户资格', minWidth: 240, slots: { default: 'conditions' } },
    { field: 'other', title: '其他业务条件（各模块另行检查）', minWidth: 220 },
    { title: '规则来源', width: 130, slots: { default: 'source' } },
    { title: '操作', width: 80, fixed: 'right', slots: { default: 'edit' } },
  ],
  data: rules,
  showOverflow: false,
});

const [RuleForm, ruleForm] = useVbenForm({
  layout: 'vertical',
  showDefaultActions: false,
  schema: [
    { component: 'CheckboxGroup', fieldName: 'draft', label: '需要满足的条件', componentProps: { class: 'grid gap-2', options: conditions } },
    { component: 'Textarea', fieldName: 'reason', label: '修改原因', componentProps: { placeholder: '填写修改原因，记入操作记录', rows: 3 } },
  ],
  handleValuesChange: (values) => { draft.value = values.draft ?? []; reason.value = values.reason ?? ''; },
});
const [RuleDrawer, ruleDrawer] = useVbenDrawer({
  class: 'w-full sm:w-[520px]',
  onClosed: () => { editing.value = undefined; },
  onOpenChange: (open) => { if (open) void ruleForm.setValues({ draft: [...draft.value], reason: '' }); },
});

function open(rule: Rule) { editing.value = rule; draft.value = [...effective(rule)]; reason.value = ''; saved.value = ''; ruleDrawer.setState({ title: rule.action }).open(); }
const changed = computed(() => editing.value && JSON.stringify(draft.value.toSorted()) !== JSON.stringify(effective(editing.value).toSorted()));
const added = computed(() => (editing.value ? draft.value.filter((v) => !effective(editing.value!).includes(v)) : []));
const removed = computed(() => (editing.value ? effective(editing.value).filter((v) => !draft.value.includes(v)) : []));
function save() {
  if (!editing.value) return;
  if (scope.value === 'school') { editing.value.override = [...draft.value]; editing.value.overrideRevision = (editing.value.overrideRevision ?? 0) + 1; }
  else { editing.value.site = [...draft.value]; editing.value.revision++; }
  saved.value = '已保存。后续操作按新规则判断，既有记录不受影响。';
}
</script>

<template>
  <Page title="动作资格" description="按动作配置用户需要满足的身份条件。全站默认适用于所有学校，获授权的学校管理员可在本校范围内收紧或放宽。">
    <PrototypeNote spec="action-eligibility" />
    <Card :bordered="false">
      <Space class="mb-4" wrap>
        <Segmented v-model:value="scope" :options="[{ label: '全站默认', value: 'site' }, { label: '示例大学（学校覆盖）', value: 'school' }]" />
        <span class="text-muted-foreground text-sm">多个条件需同时满足。资格只说明身份条件，内容归属、管理范围、价格等由业务模块另行检查。</span>
      </Space>
      <Grid>
        <template #conditions="{ row }">
          <Space :size="[4, 4]" wrap><Tag v-for="c in effective(row)" :key="c" :color="c === 'guest' ? 'green' : 'blue'">{{ labelOf(c) }}</Tag></Space>
        </template>
        <template #source="{ row }"><Tag :color="source(row) === '全站默认' ? 'default' : 'purple'">{{ source(row) }}</Tag></template>
        <template #edit="{ row }"><Button type="link" size="small" @click="open(row)">调整</Button></template>
      </Grid>
    </Card>
    <RuleDrawer>
      <template v-if="editing">
        <Descriptions :column="1" size="small" bordered class="mb-4">
          <DescriptionsItem label="作用范围">{{ scope === 'site' ? '全站默认' : '示例大学' }}</DescriptionsItem>
          <DescriptionsItem label="规则修订">{{ scope === 'site' ? editing.revision : (editing.overrideRevision ?? '尚无覆盖') }}</DescriptionsItem>
          <DescriptionsItem label="其他业务条件">{{ editing.other }}</DescriptionsItem>
        </Descriptions>
        <RuleForm />
        <Alert v-if="changed" class="mt-4" type="info" show-icon message="保存前确认变更结果">
          <template #description>
            <p v-if="added.length > 0">新增要求：{{ added.map(labelOf).join('、') }}（会拒绝不满足的用户）</p>
            <p v-if="removed.length > 0">取消要求：{{ removed.map(labelOf).join('、') }}（会放宽条件）</p>
            <p>预计影响：示例大学约 1,240 名活跃用户中，约 86 人在下次操作时结果会改变。</p>
          </template>
        </Alert>
        <Alert v-if="saved" class="mt-4" type="success" :message="saved" show-icon />
      </template>
      <template #footer>
        <Button @click="ruleDrawer.close()">关闭</Button>
        <Button type="primary" :disabled="!changed || !reason.trim()" @click="save">保存规则</Button>
      </template>
    </RuleDrawer>
  </Page>
</template>
