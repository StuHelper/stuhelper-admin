<script setup lang="ts">
import { computed, markRaw, reactive } from 'vue';

import { Page } from '@vben/common-ui';

import { Card, Col, List, ListItem, Row, Select, Slider, Tag } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';

import PrototypeNote from './PrototypeNote.vue';

type Weight = 'favorite' | 'interaction' | 'review' | 'view';
const weights = reactive<Record<Weight, number>>({ view: 20, review: 40, favorite: 25, interaction: 15 });
const settings = reactive({ window: 30, minSample: 5 });
const weightLabels: Record<Weight, string> = { view: '浏览', review: '评价', favorite: '收藏', interaction: '互动' };
// The preview ranking follows the sliders before saving, so the form mirrors its values here.
// Slider is not registered in the form adapter, so its v-model prop is named explicitly.
const [WeightForm] = useVbenForm({
  layout: 'vertical',
  wrapperClass: 'grid-cols-2',
  schema: [
    ...(Object.keys(weightLabels) as Weight[]).map((key) => ({
      component: markRaw(Slider), fieldName: key, modelPropName: 'value', defaultValue: weights[key], formItemClass: 'col-span-2', label: () => `${weightLabels[key]} ${weights[key]}`, componentProps: { class: 'w-full', max: 100 },
    })),
    { component: 'InputNumber', fieldName: 'window', label: '统计窗口（天）', defaultValue: settings.window, componentProps: { class: 'w-full', min: 1 } },
    { component: 'InputNumber', fieldName: 'minSample', label: '趋势最低样本量', defaultValue: settings.minSample, componentProps: { class: 'w-full', min: 1 } },
  ],
  actionPosition: 'left',
  handleValuesChange: (values) => { Object.assign(weights, { view: values.view, review: values.review, favorite: values.favorite, interaction: values.interaction }); Object.assign(settings, { window: values.window, minSample: values.minSample }); },
  resetButtonOptions: { show: false },
  submitButtonOptions: { content: '保存' },
});
const courses = [
  { name: '操作系统', view: 980, review: 46, favorite: 120, interaction: 210 },
  { name: '数据结构', view: 1210, review: 38, favorite: 98, interaction: 150 },
  { name: '人工智能导论', view: 1630, review: 12, favorite: 210, interaction: 90 },
  { name: '线性代数', view: 760, review: 29, favorite: 40, interaction: 70 },
  { name: '大学英语', view: 540, review: 3, favorite: 12, interaction: 20 },
];
const ranked = computed(() => {
  const max = (k: Weight) => Math.max(...courses.map((c) => c[k]));
  return courses.map((c) => ({ ...c, score: Math.round(weights.view * c.view / max('view') + weights.review * c.review / max('review') + weights.favorite * c.favorite / max('favorite') + weights.interaction * c.interaction / max('interaction')) })).toSorted((a, b) => b.score - a.score);
});
const levels = ['很差', '较差', '一般', '较好', '很好'];
const trend = [
  { term: '2025 秋', samples: 18, level: 3 }, { term: '2026 春', samples: 22, level: 3 }, { term: '2026 秋', samples: 4, level: -1 },
];
</script>

<template>
  <Page title="发现与统计" description="配置热门榜单的热度权重和统计窗口。榜单与趋势只纳入当前可见的有效评价。">
    <PrototypeNote spec="discovery-and-statistics" />
    <Row :gutter="16">
      <Col :xs="24" :lg="10">
        <Card :bordered="false" title="热度权重"><WeightForm /></Card>
      </Col>
      <Col :xs="24" :lg="14">
        <Card :bordered="false" title="热门课程预览（示例大学）">
          <template #extra><Select value="course" size="small" :options="[{ value: 'course', label: '课程' }, { value: 'teacher', label: '教师' }]" /></template>
          <List :data-source="ranked" size="small">
            <template #renderItem="{ item, index }">
              <ListItem><span><Tag :color="index < 3 ? 'blue' : 'default'">{{ index + 1 }}</Tag>{{ item.name }}</span><span class="text-muted-foreground text-xs">浏览 {{ item.view }} · 评价 {{ item.review }} · 收藏 {{ item.favorite }} · 热度 {{ item.score }}</span></ListItem>
            </template>
          </List>
        </Card>
        <Card :bordered="false" title="评分趋势预览：操作系统 · 推荐度" class="mt-4">
          <List :data-source="trend" size="small">
            <template #renderItem="{ item }">
              <ListItem>
                <span>{{ item.term }}</span>
                <span>
                  <Tag v-if="item.samples < settings.minSample">暂无足够数据</Tag><Tag v-else color="green">{{ levels[item.level] }}</Tag>
                  <span class="text-muted-foreground text-xs">样本 {{ item.samples }} 条</span>
                </span>
              </ListItem>
            </template>
          </List>
          <p class="text-muted-foreground mt-2 text-sm">趋势使用五级文字，不显示精确评分数字。</p>
        </Card>
      </Col>
    </Row>
  </Page>
</template>
