<script setup lang="ts">
import { computed, ref } from 'vue';

import { Alert, Button, Drawer, Input, message, Modal, Select, Table, Tag } from 'ant-design-vue';

import AdminPage from '#/shared/ui/AdminPage.vue';

const kind = ref('user');
const q = ref('');
const searched = ref(false);
const detail = ref<Record<string, any>>();
const revealed = ref(false);
const reason = ref('');
const asking = ref(false);
const users = [
  { id: 'u-1024', name: '小航同学', phone: '138****2046', student: '23****17', state: '学生认证有效', joined: '2025-09-03', reviews: 1, resources: 2, ivory: 128 },
  { id: 'u-2048', name: '航小北', phone: '139****7781', student: '22****05', state: '学生认证有效', joined: '2024-09-05', reviews: 12, resources: 7, ivory: 460 },
  { id: 'u-4096', name: '云上', phone: '137****3351', student: '未认证', state: '未认证', joined: '2026-10-11', reviews: 0, resources: 0, ivory: 0 },
];
const rows = computed(() => (searched.value ? users.filter((u) => !q.value.trim() || u.name.includes(q.value.trim()) || u.id.includes(q.value.trim())) : []));
function reveal() { revealed.value = true; asking.value = false; reason.value = ''; message.success('已显示完整手机号，本次查看已记录'); }
</script>

<template>
  <AdminPage title="全站信息查询" description="按当前权限返回结果，敏感字段默认脱敏，查看完整内容需要填写原因。">
    <section class="demo-card">
      <form class="flex flex-wrap gap-2" @submit.prevent="searched = true">
        <Select v-model:value="kind" class="w-32" aria-label="查询类型" :options="[{ value: 'user', label: '用户' }, { value: 'order', label: '订单' }, { value: 'content', label: '内容' }]" />
        <Input v-model:value="q" class="flex-1 min-w-48" placeholder="昵称、用户 ID 或手机号后四位" allow-clear aria-label="查询内容" />
        <Button type="primary" html-type="submit">查询</Button>
      </form>
      <p v-if="!searched" class="demo-note">输入条件后查询。为减少不必要的访问，这里不提供全量浏览。</p>
      <Table v-else class="mt-3" row-key="id" size="small" :pagination="false" :data-source="rows" :scroll="{ x: 640 }" :custom-row="(r: any) => ({ onClick: () => { detail = r; revealed = false; }, style: 'cursor:pointer' })" :columns="[{ title: '用户', dataIndex: 'name' }, { title: 'ID', dataIndex: 'id' }, { title: '手机', dataIndex: 'phone' }, { title: '状态', key: 'state' }, { title: '注册', dataIndex: 'joined' }]">
        <template #bodyCell="{ column, record }"><template v-if="column.key === 'state'"><Tag :color="record.state === '未认证' ? 'default' : 'green'">{{ record.state }}</Tag></template></template>
      </Table>
    </section>
    <Drawer :open="!!detail" :title="detail?.name" width="min(460px, 100vw)" @close="detail = undefined">
      <dl class="demo-facts">
        <dt>用户 ID</dt><dd>{{ detail?.id }}</dd>
        <dt>手机</dt><dd>{{ revealed ? '13812342046' : detail?.phone }} <a v-if="!revealed" @click="asking = true">查看完整</a></dd>
        <dt>学号</dt><dd>{{ detail?.student }}</dd><dt>认证状态</dt><dd>{{ detail?.state }}</dd>
        <dt>评价 / 资料</dt><dd>{{ detail?.reviews }} / {{ detail?.resources }}</dd><dt>Ivory 余额</dt><dd>{{ detail?.ivory }}</dd>
      </dl>
      <Alert class="mt-4" type="info" show-icon message="这个页面不显示认证材料和支付载荷。需要时请到对应模块按权限处理。" />
    </Drawer>
    <Modal :open="asking" title="查看完整手机号" ok-text="确认查看" :ok-button-props="{ disabled: reason.trim().length < 4 }" cancel-text="取消" @ok="reveal" @cancel="asking = false">
      <p class="demo-note">查看行为会记录操作者、对象和原因。</p>
      <label class="demo-field">查看原因<Input v-model:value="reason" placeholder="例如：工单 2041 需要联系本人" /></label>
    </Modal>
  </AdminPage>
</template>
