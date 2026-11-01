<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import { Button, Checkbox, CheckboxGroup, Drawer, Input, message, Popconfirm, Select, Table, Tag } from 'ant-design-vue';

import AdminPage from '#/shared/ui/AdminPage.vue';

const perms = [
  { group: '内容', items: ['审核评价', '审核资料', '发布公告'] }, { group: '学生认证', items: ['审核认证申请', '查看认证材料'] },
  { group: '账务', items: ['查看账务', '处理退款'] }, { group: '系统', items: ['管理角色', '查看操作记录', '管理存储'] },
];
const roles = reactive([
  { id: 'r1', name: '超级管理员', members: 2, perms: perms.flatMap((p) => p.items), builtin: true },
  { id: 'r2', name: '内容审核员', members: 6, perms: ['审核评价', '审核资料'], builtin: false },
  { id: 'r3', name: '认证审核员', members: 3, perms: ['审核认证申请', '查看认证材料'], builtin: false },
  { id: 'r4', name: '财务专员', members: 1, perms: ['查看账务', '处理退款'], builtin: false },
]);
const people = reactive([
  { id: 'u1', name: '运营值班', phone: '138****2046', role: 'r1', scope: '全部', until: '长期' },
  { id: 'u2', name: '航小北', phone: '139****7781', role: 'r2', scope: '评价、资料', until: '2027-01-31' },
  { id: 'u3', name: '不周山', phone: '137****1120', role: 'r3', scope: '学生认证', until: '2026-12-31' },
]);
const editing = ref<(typeof roles)[number]>();
const draft = ref<string[]>([]);
const grant = ref(false);
const form = reactive({ name: '', role: 'r2', until: '' });
const dirty = computed(() => editing.value && [...draft.value].sort().join() !== [...editing.value.perms].sort().join());
const roleName = (id: string) => roles.find((r) => r.id === id)?.name;
function open(role: (typeof roles)[number]) { editing.value = role; draft.value = [...role.perms]; }
function save() { if (editing.value) editing.value.perms = [...draft.value]; editing.value = undefined; message.success('角色权限已更新，已写入操作记录'); }
function addPerson() { people.unshift({ id: `u${Date.now()}`, name: form.name, phone: '***', role: form.role, scope: roleName(form.role) ?? '', until: form.until || '长期' }); grant.value = false; form.name = ''; form.until = ''; message.success('已授予角色'); }
</script>

<template>
  <AdminPage title="角色授权" description="按角色分配管理权限。每次变更都会写入操作记录。">
    <div class="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <section class="demo-card">
        <h2 class="demo-h">角色</h2>
        <button v-for="r in roles" :key="r.id" type="button" class="demo-row" @click="open(r)">
          <span><b>{{ r.name }}</b><small>{{ r.members }} 人 · {{ r.perms.length }} 项权限</small></span>
          <Tag v-if="r.builtin">内置</Tag>
        </button>
      </section>
      <section class="demo-card">
        <div class="flex items-center justify-between"><h2 class="demo-h">管理员</h2><Button type="primary" size="small" @click="grant = true">授予角色</Button></div>
        <Table row-key="id" size="small" :pagination="false" :data-source="people" :scroll="{ x: 560 }" :columns="[{ title: '账号', dataIndex: 'name' }, { title: '手机', dataIndex: 'phone' }, { title: '角色', key: 'role' }, { title: '有效期', dataIndex: 'until' }, { title: '', key: 'op', width: 70 }]">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'role'"><Tag color="blue">{{ roleName(record.role) }}</Tag></template>
            <template v-if="column.key === 'op'"><Popconfirm title="撤销该管理员的角色？" @confirm="people.splice(people.findIndex((x) => x.id === record.id), 1); message.success('已撤销')"><a>撤销</a></Popconfirm></template>
          </template>
        </Table>
      </section>
    </div>
    <Drawer :open="!!editing" :title="editing?.name" width="min(440px, 100vw)" @close="editing = undefined">
      <CheckboxGroup v-model:value="draft" class="grid gap-4" :disabled="editing?.builtin">
        <fieldset v-for="p in perms" :key="p.group"><legend class="demo-h">{{ p.group }}</legend><div class="grid gap-1"><Checkbox v-for="i in p.items" :key="i" :value="i">{{ i }}</Checkbox></div></fieldset>
      </CheckboxGroup>
      <p v-if="editing?.builtin" class="demo-note">内置角色的权限不能修改。</p>
      <template #footer><Button type="primary" :disabled="!dirty" @click="save">保存</Button></template>
    </Drawer>
    <Drawer :open="grant" title="授予角色" width="min(420px, 100vw)" @close="grant = false">
      <div class="grid gap-3">
        <label class="demo-field">账号<Input v-model:value="form.name" placeholder="昵称或手机号" /></label>
        <label class="demo-field">角色<Select v-model:value="form.role" :options="roles.map((r) => ({ value: r.id, label: r.name }))" /></label>
        <label class="demo-field">有效期至（留空表示长期）<Input v-model:value="form.until" placeholder="2027-01-31" /></label>
      </div>
      <template #footer><Button type="primary" :disabled="!form.name.trim()" @click="addPerson">授予</Button></template>
    </Drawer>
  </AdminPage>
</template>
