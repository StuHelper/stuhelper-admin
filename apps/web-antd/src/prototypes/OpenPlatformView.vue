<script setup lang="ts">
import { reactive, ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';

import { Alert, Button, Card, Descriptions, DescriptionsItem, Space, Steps, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';

import { useMockGrid } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

const scopes = ['学生认证状态', '所属学校', 'QQ 绑定信息（需用户单独授权）'];
type App = { approved: string[]; at: string; developer: string; feedback?: string; id: string; name: string; purpose: string; scopes: string[]; state: string; users: number };
const apps = reactive<App[]>([
  { id: 'app-31', name: '课表助手', developer: '示例工作室', purpose: '根据学校展示对应课表模板', scopes: ['学生认证状态', '所属学校'], approved: [], state: '待审核', users: 0, at: '2026-11-01' },
  { id: 'app-28', name: '校园跑腿', developer: '演示团队', purpose: '仅限在校学生接单', scopes: ['学生认证状态', 'QQ 绑定信息（需用户单独授权）'], approved: ['学生认证状态'], state: '需修改', users: 0, at: '2026-10-29', feedback: 'QQ 绑定信息用途说明不足' },
  { id: 'app-12', name: '社团报名', developer: '示例大学学生会', purpose: '核验报名者在读身份', scopes: ['学生认证状态', '所属学校'], approved: ['学生认证状态', '所属学校'], state: '已批准', users: 1288, at: '2026-09-15' },
  { id: 'app-07', name: '旧版查分工具', developer: '个人开发者', purpose: '已停止维护', scopes: ['学生认证状态'], approved: ['学生认证状态'], state: '已停用', users: 64, at: '2026-03-02' },
]);
const color: Record<string, string> = { 待审核: 'orange', 需修改: 'gold', 已批准: 'green', 已停用: 'default' };
const current = ref<App>();
const approved = ref<string[]>([]);
const feedback = ref('');

const [Grid] = useMockGrid<App>({
  columns: [
    { field: 'name', title: '应用' }, { field: 'developer', title: '开发者' }, { title: '申请范围', minWidth: 260, slots: { default: 'scopes' } },
    { title: '状态', slots: { default: 'state' } }, { field: 'users', title: '授权用户' }, { field: 'at', title: '提交时间' }, { title: '操作', width: 80, fixed: 'right', slots: { default: 'action' } },
  ],
  data: apps,
  showOverflow: false,
});
const [ReviewForm, reviewForm] = useVbenForm({
  layout: 'vertical',
  showDefaultActions: false,
  schema: [
    { component: 'CheckboxGroup', fieldName: 'approved', label: '批准的信息范围', componentProps: { class: 'grid gap-2' } },
    { component: 'Textarea', fieldName: 'feedback', label: '审核意见', componentProps: { placeholder: '审核意见，反馈给开发者', rows: 3 } },
  ],
  handleValuesChange: (values) => { approved.value = values.approved ?? []; feedback.value = values.feedback ?? ''; },
});
const [ReviewDrawer, reviewDrawer] = useVbenDrawer({
  class: 'w-full sm:w-[520px]',
  onClosed: () => { current.value = undefined; },
  onOpenChange: (open) => {
    if (!open || !current.value) return;
    const app = current.value;
    // Only scopes the developer asked for can be approved.
    reviewForm.updateSchema([{ fieldName: 'approved', componentProps: { options: scopes.map((s) => ({ label: s, value: s, disabled: !app.scopes.includes(s) })) } }]);
    void reviewForm.setValues({ approved: [...app.approved], feedback: '' });
  },
});
function open(app: App) { current.value = app; approved.value = [...app.approved]; feedback.value = ''; reviewDrawer.setState({ title: app.name }).open(); }
function decide(state: string) {
  if (!current.value) return;
  Object.assign(current.value, { approved: [...approved.value], feedback: feedback.value, state });
  reviewDrawer.close();
}
</script>

<template>
  <Page title="开放平台" description="审核第三方应用申请的信息范围。登录能力不等于业务授权，未获批的范围不会开通。">
    <PrototypeNote spec="open-platform" />
    <Card :bordered="false">
      <Grid>
        <template #scopes="{ row }"><Space :size="[4, 4]" wrap><Tag v-for="s in row.scopes" :key="s" :color="row.approved.includes(s) ? 'green' : 'default'">{{ s }}</Tag></Space></template>
        <template #state="{ row }"><Tag :color="color[row.state]">{{ row.state }}</Tag></template>
        <template #action="{ row }"><Button type="link" size="small" @click="open(row)">{{ row.state === '待审核' ? '审核' : '查看' }}</Button></template>
      </Grid>
    </Card>
    <ReviewDrawer>
      <template v-if="current">
        <Steps size="small" class="mb-4" :current="current.state === '已批准' ? 2 : 1" :items="[{ title: '提交申请' }, { title: '管理员审核' }, { title: '用户逐项授权' }]" />
        <Descriptions :column="1" size="small" bordered class="mb-4">
          <DescriptionsItem label="开发者">{{ current.developer }}</DescriptionsItem>
          <DescriptionsItem label="用途">{{ current.purpose }}</DescriptionsItem>
          <DescriptionsItem v-if="current.feedback" label="上次反馈">{{ current.feedback }}</DescriptionsItem>
        </Descriptions>
        <ReviewForm />
        <Alert type="info" show-icon message="证件、认证材料和钱包原始记录不开放。用户仍需在授权页逐项同意。" />
      </template>
      <template #footer>
        <Button danger @click="decide('已停用')">停用</Button>
        <Button :disabled="!feedback.trim()" @click="decide('需修改')">要求修改</Button>
        <Button type="primary" :disabled="approved.length === 0" @click="decide('已批准')">批准所选范围</Button>
      </template>
    </ReviewDrawer>
  </Page>
</template>
