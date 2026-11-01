<script setup lang="ts">
import { reactive, ref } from 'vue';

import { Button, Drawer, message, Switch, Table, Tag } from 'ant-design-vue';

import AdminPage from '#/shared/ui/AdminPage.vue';

const groups = reactive([
  { id: 'g1', name: '北航 2026 秋 数据结构答疑群', number: '83****21', members: 412, bot: true, need: true, pending: 3 },
  { id: 'g2', name: '北航 StuHelper 反馈群', number: '71****09', members: 1280, bot: true, need: false, pending: 0 },
  { id: 'g3', name: '北航 飞行器设计兴趣群', number: '65****44', members: 96, bot: false, need: true, pending: 1 },
]);
const applicants = reactive([
  { id: 'p1', group: 'g1', name: '航小北', state: '学生认证有效', at: '2 小时前' },
  { id: 'p2', group: 'g1', name: '云上', state: '未认证', at: '5 小时前' },
  { id: 'p3', group: 'g1', name: '不周山', state: '学生认证有效', at: '1 天前' },
  { id: 'p4', group: 'g3', name: '小航同学', state: '学生认证有效', at: '1 天前' },
]);
const open = ref<(typeof groups)[number]>();
function decide(row: (typeof applicants)[number], ok: boolean) { applicants.splice(applicants.indexOf(row), 1); const g = groups.find((x) => x.id === row.group); if (g) { g.pending--; if (ok) g.members++; } message.success(ok ? `已同意 ${row.name} 入群` : `已拒绝 ${row.name}`); }
</script>

<template>
  <AdminPage title="QQ 群管理" description="管理机器人服务的群、入群条件和待审批的申请。">
    <section class="demo-card">
      <Table row-key="id" size="small" :pagination="false" :data-source="groups" :scroll="{ x: 720 }" :columns="[{ title: '群名称', dataIndex: 'name' }, { title: '群号', dataIndex: 'number', width: 100 }, { title: '成员', dataIndex: 'members', width: 80 }, { title: '机器人', key: 'bot', width: 80 }, { title: '要求学生认证', key: 'need', width: 120 }, { title: '待审批', key: 'pending', width: 110 }]">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'bot'"><Switch v-model:checked="record.bot" size="small" :aria-label="`${record.name} 机器人`" /></template>
          <template v-if="column.key === 'need'"><Switch v-model:checked="record.need" size="small" :aria-label="`${record.name} 要求认证`" /></template>
          <template v-if="column.key === 'pending'"><Button v-if="record.pending" size="small" type="primary" ghost @click="open = record as any">{{ record.pending }} 条</Button><span v-else class="demo-muted">无</span></template>
        </template>
      </Table>
    </section>
    <Drawer :open="!!open" :title="open?.name" width="min(460px, 100vw)" @close="open = undefined">
      <ul class="grid gap-2">
        <li v-for="row in applicants.filter((a) => a.group === open?.id)" :key="row.id" class="demo-row still">
          <span><b>{{ row.name }}</b><small><Tag :color="row.state === '未认证' ? 'orange' : 'green'">{{ row.state }}</Tag>{{ row.at }}</small></span>
          <span class="flex gap-1"><Button size="small" @click="decide(row, false)">拒绝</Button><Button size="small" type="primary" :disabled="open?.need && row.state === '未认证'" @click="decide(row, true)">同意</Button></span>
        </li>
      </ul>
      <p v-if="open?.need" class="demo-note">这个群要求学生认证，未认证的申请不能同意。</p>
    </Drawer>
  </AdminPage>
</template>
