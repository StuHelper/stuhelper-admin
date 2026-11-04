<script setup lang="ts">
import { computed, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Alert, Badge, Button, Card, Checkbox, CheckboxGroup, Col, Divider, List, ListItem, Row, Select, Space, Tag } from 'ant-design-vue';

import { useMockGrid } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

const groups = [
  { title: '内容', items: ['查看待审核内容', '审核评价与回复', '处理举报', '批量处置', '管理审核规则'] },
  { title: '资料', items: ['查看资料', '审核资料', '管理分类与目录', '授予资料访问权'] },
  { title: '认证与目录', items: ['审核学生认证', '管理学校认证配置', '维护课程与教师'] },
  { title: '群聊', items: ['查看群成员与资格', '警告与禁言', '管理关键词与防复读', '查看撤回消息'] },
  { title: '配置', items: ['修改动作资格', '分配角色'] },
];
const sensitive = ['查看完整身份字段', '查看认证材料', '账务查询', '数据导出', '资金操作'];
const roles = ref([
  { key: 'platform', name: '平台管理员', members: 2, perms: groups.flatMap((g) => g.items), sensitive: [...sensitive], scope: '全站' },
  { key: 'school', name: '学校管理员', members: 5, perms: ['查看待审核内容', '审核评价与回复', '处理举报', '审核学生认证', '维护课程与教师', '修改动作资格'], sensitive: ['查看完整身份字段'], scope: '指定学校' },
  { key: 'content', name: '内容审核', members: 9, perms: ['查看待审核内容', '审核评价与回复', '处理举报'], sensitive: [], scope: '指定学校' },
  { key: 'resource', name: '资料管理', members: 4, perms: ['查看资料', '审核资料', '管理分类与目录'], sensitive: [], scope: '指定学校' },
  { key: 'group', name: '群管理', members: 12, perms: ['查看群成员与资格', '警告与禁言', '管理关键词与防复读', '查看撤回消息'], sensitive: [], scope: '指定群' },
  { key: 'finance', name: '财务', members: 1, perms: [], sensitive: ['账务查询', '资金操作'], scope: '账务模块' },
]);
const current = ref('school');
const role = computed(() => roles.value.find((r) => r.key === current.value)!);
const [MemberGrid] = useMockGrid({
  columns: [{ field: 'name', title: '成员' }, { field: 'id', title: '账号' }, { title: '获准范围', minWidth: 260, slots: { default: 'scope' } }, { field: 'since', title: '授予时间' }],
  data: [
    { name: '王**', id: 'u-1021', scope: ['示例大学'], since: '2026-09-01' },
    { name: '刘**', id: 'u-1188', scope: ['示例大学', '演示理工学院'], since: '2026-10-12' },
    { name: '何**', id: 'u-1302', scope: ['示例大学'], since: '2026-10-20' },
  ],
  showOverflow: false,
});
</script>

<template>
  <Page title="角色与范围" description="角色模板只是权限组合，实际能处理什么还取决于对象范围。敏感能力单独授予。">
    <PrototypeNote spec="admin-operations" />
    <Row :gutter="16">
      <Col :xs="24" :lg="7">
        <Card :bordered="false" title="角色模板">
          <template #extra><Button type="link" size="small">新建角色</Button></template>
          <List :data-source="roles" size="small">
            <template #renderItem="{ item }">
              <ListItem class="cursor-pointer rounded px-2" :class="{ 'bg-accent': item.key === current }" @click="current = item.key">
                <span>{{ item.name }}</span><Badge :count="item.members" :number-style="{ backgroundColor: 'hsl(var(--primary))' }" />
              </ListItem>
            </template>
          </List>
        </Card>
      </Col>
      <Col :xs="24" :lg="17">
        <Card :bordered="false" :title="role.name">
          <template #extra><Tag>范围类型：{{ role.scope }}</Tag></template>
          <Row :gutter="[16, 16]">
            <Col v-for="g in groups" :key="g.title" :xs="24" :md="12" :xl="8">
              <h4 class="mb-2 font-semibold">{{ g.title }}</h4>
              <CheckboxGroup v-model:value="role.perms" class="grid gap-1">
                <Checkbox v-for="p in g.items" :key="p" :value="p">{{ p }}</Checkbox>
              </CheckboxGroup>
            </Col>
          </Row>
          <Divider />
          <h4 class="mb-2 font-semibold text-red-500">敏感能力（单独授予，不随模板名称自动获得）</h4>
          <CheckboxGroup v-model:value="role.sensitive" class="flex flex-wrap gap-3">
            <Checkbox v-for="p in sensitive" :key="p" :value="p">{{ p }}</Checkbox>
          </CheckboxGroup>
          <Alert class="mt-4" type="info" show-icon message="查询权不能代替操作权。例如“账务查询”不能退款，“查看群成员”不能修改认证。" />
          <Space class="mt-4"><Button type="primary">保存角色</Button><span class="text-muted-foreground text-sm">修订 7 · 若他人已修改，将提示比较差异后重试</span></Space>
        </Card>
        <Card :bordered="false" title="成员与管理范围" class="mt-4">
          <template #extra><Button size="small">添加成员</Button></template>
          <MemberGrid>
            <template #scope="{ row }">
              <Select v-model:value="row.scope" mode="multiple" size="small" class="w-full" :options="[{ value: '示例大学' }, { value: '演示理工学院' }]" />
            </template>
          </MemberGrid>
        </Card>
      </Col>
    </Row>
  </Page>
</template>
