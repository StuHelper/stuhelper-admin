<script setup lang="ts">
import { reactive } from 'vue';

import { Page } from '@vben/common-ui';

import { Alert, Card, Col, InputNumber, Row, Slider, Switch, Tag } from 'ant-design-vue';

import { useMockGrid } from './mock-grid';
import PrototypeNote from './PrototypeNote.vue';

const groups = reactive([
  { id: 'g1', name: '示例大学 2026 新生群', dice: true, faces: 100, mute: true, chance: 30, maxMinutes: 10, cooldown: 300, floor: 3 },
  { id: 'g2', name: '示例大学计算机学院交流群', dice: true, faces: 6, mute: false, chance: 0, maxMinutes: 0, cooldown: 0, floor: 0 },
  { id: 'g3', name: '示例大学二手交易群', dice: false, faces: 0, mute: false, chance: 0, maxMinutes: 0, cooldown: 0, floor: 0 },
]);
const [LogGrid] = useMockGrid({
  columns: [{ field: 'at', title: '时间' }, { field: 'group', title: '群' }, { field: 'who', title: '发起者' }, { field: 'cmd', title: '命令' }, { title: '实际结果', minWidth: 220, slots: { default: 'result' } }],
  data: [
    { at: '11-02 10:31', group: '新生群', who: 'Q****1021', cmd: '掷骰子 d100', result: '掷出 87' },
    { at: '11-02 10:28', group: '新生群', who: 'Q****6634', cmd: '自助禁言', result: '禁言 4 分钟（自愿，不计违规）' },
    { at: '11-02 09:55', group: '计算机群', who: 'Q****3307', cmd: '自助禁言', result: '本群未开放，未执行' },
  ],
});
</script>

<template>
  <Page title="娱乐功能" description="按群启停骰子和自助禁言。命令只作用于主动发起者，不记录为违规；未配置的群不启用。">
    <PrototypeNote spec="bot-entertainment" />
    <Row :gutter="[16, 16]">
      <Col v-for="g in groups" :key="g.id" :xs="24" :xl="8">
        <Card :bordered="false" :title="g.name">
          <div class="mb-3 flex items-center justify-between"><span class="font-medium">掷骰子</span><Switch v-model:checked="g.dice" /></div>
          <div v-if="g.dice" class="mb-4 flex items-center gap-2 text-sm">骰子面数 <InputNumber v-model:value="g.faces" :min="2" :max="1000" size="small" /></div>
          <div class="mb-3 flex items-center justify-between"><span class="font-medium">自助禁言</span><Switch v-model:checked="g.mute" /></div>
          <template v-if="g.mute">
            <div class="text-sm">禁言概率 {{ g.chance }}%</div><Slider v-model:value="g.chance" :max="100" />
            <div class="grid grid-cols-3 gap-2 text-sm">
              <label>时长上限（分）<InputNumber v-model:value="g.maxMinutes" :min="1" size="small" class="w-full" /></label>
              <label>冷却（秒）<InputNumber v-model:value="g.cooldown" :min="0" size="small" class="w-full" /></label>
              <label>保底次数<InputNumber v-model:value="g.floor" :min="0" size="small" class="w-full" /></label>
            </div>
          </template>
          <Alert v-if="!g.dice && !g.mute" type="info" message="本群未开放娱乐功能，成员调用时会提示不可用。" show-icon />
        </Card>
      </Col>
    </Row>
    <Card :bordered="false" title="最近使用记录" class="mt-4">
      <LogGrid>
        <template #result="{ row }"><Tag :color="row.result.includes('未执行') ? 'default' : 'blue'">{{ row.result }}</Tag></template>
      </LogGrid>
    </Card>
  </Page>
</template>
