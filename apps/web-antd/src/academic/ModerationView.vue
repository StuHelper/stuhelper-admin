<script setup lang="ts">
import { computed,nextTick,ref,watch } from 'vue';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Alert, Button, Card, DatePicker, Empty, Select, Space, TabPane, Tabs, Tag } from 'ant-design-vue';

import { confirmLeave } from '#/confirm-leave';
import { rememberedSchool,rememberSchool,tagColor } from '#/console-ui';

import { type AdminPage,call,objectOptions,query,type Task } from './api';
import BatchPanel from './BatchPanel.vue';
import DecisionPanel from './DecisionPanel.vue';
import PolicyEditor from './PolicyEditor.vue';
import PresentationEditor from './PresentationEditor.vue';
import StatusBlock from './StatusBlock.vue';
import { useLoad } from './useLoad';

import './console.css';
const {t,d}=useI18n();
const moreFilters=ref(false);const from=ref('');const until=ref('');const taskKind=ref('');const batchPending=ref(false);
const after=ref(''); const history=ref<string[]>([]); const kind=ref(''); const school=ref(''); const state=ref('waiting'); const tab=ref('queue');
const childBusy=ref(false); const childDirty=ref(false); const panel=ref<HTMLElement>(); const selected=ref<{entryId?:string;taskId?:string;}>();
const schools=useLoad(signal=>objectOptions({kind:'school'},signal));
const data=useLoad(async signal=>{
  if(!school.value||['policyManagement','presentationTitle'].includes(tab.value))return {tasks:[],entries:[],next:''};
  if(tab.value==='queue'){
    const tasks=await call<Task[]>('moderation','/tasks'+query({admin:'true',school_id:school.value,state:state.value,after:after.value,limit:'20',kind:taskKind.value,content_kind:kind.value,from:from.value?new Date(from.value).toISOString():undefined,until:until.value?new Date(until.value).toISOString():undefined}),'TaskView',{signal,array:true});
    return {tasks:tasks.filter(task=>task.content_kind!=='resource'),entries:[],next:tasks.length===20?tasks.at(-1)?.id??'':''};
  }
  const page=await call<AdminPage>('reviews','/admin/entries'+query({school_id:school.value,kind:kind.value,state:state.value,after:after.value,limit:'20'}),'AdminPage',{signal});
  return {tasks:[],entries:page.items,next:page.next};
});
watch(()=>schools.data.value,rows=>{if(rows&&!school.value)school.value=rememberedSchool(rows.items.map(item=>item.id))});
watch(school,rememberSchool);
void schools.load();
watch([tab,school],()=>{selected.value=undefined;childDirty.value=false;state.value=tab.value==='queue'?'waiting':'';kind.value='';after.value='';history.value=[];void data.load()},{immediate:true});
const empty=computed(()=>!!data.data.value&&data.data.value.tasks.length === 0&&data.data.value.entries.length === 0);
function apply(){if(childBusy.value||childDirty.value)return;after.value='';history.value=[];selected.value=undefined;void data.load()}
function next(){if(data.data.value?.next){history.value.push(after.value);after.value=data.data.value.next;void data.load()}}
function previous(){after.value=history.value.pop()??'';void data.load()}
async function open(value:{entryId?:string;taskId?:string;}){if(childBusy.value)return;if(childDirty.value&&!(await confirmLeave(t('page.academic.unsavedChanges'))))return;selected.value=value;await nextTick();panel.value?.focus();panel.value?.scrollIntoView({behavior:'smooth',block:'start'})}
const locked=computed(()=>childBusy.value||childDirty.value||batchPending.value);
function pending(busy:boolean,dirty:boolean){childBusy.value=busy;childDirty.value=dirty}
</script>
<template>
  <Page :title="t('page.academic.adminTitle')" :description="t('page.academic.adminIntro')">
    <div class="academic-console">
      <Card :bordered="false">
        <Tabs :active-key="tab" @change="tab = String($event)">
          <TabPane v-for="item in ['queue','contentManagement','policyManagement','presentationTitle']" :key="item" :tab="t(`page.academic.${item}`)" :disabled="locked && tab !== item" />
        </Tabs>
        <form class="admin-filters" @submit.prevent="apply">
          <label>{{ t('page.academic.school') }}
            <Select v-model:value="school" :disabled="locked" :options="[{ value: '', label: t('page.academic.choose') }, ...(schools.data.value?.items ?? []).map(item => ({ value: item.id, label: item.name }))]" />
          </label>
          <template v-if="!['policyManagement','presentationTitle'].includes(tab)">
            <label>{{ t('page.academic.status') }}
              <Select v-model:value="state" :disabled="locked" :options="[{ value: '', label: t('page.academic.all') }, ...(tab === 'queue' ? ['waiting','decided','applied','failed'] : ['pending','published','hidden','deleted']).map(value => ({ value, label: t(`page.academic.${tab === 'queue' ? 'taskStates' : 'states'}.${value}`) }))]" />
            </label>
            <label>{{ t('page.academic.contentKind') }}
              <Select v-model:value="kind" :disabled="locked" :options="[{ value: '', label: t('page.academic.all') }, ...['course','mentor','reply'].map(value => ({ value, label: t(`page.academic.kind.${value}`) }))]" />
            </label>
            <template v-if="tab === 'queue' && moreFilters">
              <label>{{ t('page.academic.fromTime') }}<DatePicker v-model:value="from" show-time value-format="YYYY-MM-DDTHH:mm" :disabled="locked" /></label>
              <label>{{ t('page.academic.untilTime') }}<DatePicker v-model:value="until" show-time value-format="YYYY-MM-DDTHH:mm" :disabled="locked" /></label>
              <label>{{ t('page.academic.requestKinds.review') }}
                <Select v-model:value="taskKind" :disabled="locked" :options="[{ value: '', label: t('page.academic.all') }, ...['review','report','edit_request','delete_request','appeal'].map(value => ({ value, label: t(`page.academic.requestKinds.${value}`) }))]" />
              </label>
            </template>
            <Space>
              <Button type="primary" html-type="submit" :disabled="locked || !school">{{ t('page.academic.filter') }}</Button>
              <Button v-if="tab === 'queue'" type="link" :aria-expanded="moreFilters" @click="moreFilters = !moreFilters">{{ t('page.console.moreFilters') }}</Button>
            </Space>
          </template>
        </form>
        <StatusBlock :busy="schools.busy.value" :error="schools.error.value" @retry="schools.load" />
        <Alert v-if="!school" type="info" show-icon :message="t('page.academic.selectSchool')" />
      </Card>
      <Card v-if="school && tab === 'policyManagement'" :bordered="false"><PolicyEditor :school-id="school" @pending="pending" /></Card>
      <Card v-else-if="school && tab === 'presentationTitle'" :bordered="false"><PresentationEditor :school-id="school" @pending="pending" /></Card>
      <div v-else-if="school" class="admin-columns">
        <Card :bordered="false">
          <StatusBlock :busy="data.busy.value" :error="data.error.value" :empty="empty" @retry="data.load" />
          <BatchPanel v-if="tab === 'queue' && !selected" :tasks="data.data.value?.tasks ?? []" :disabled="childBusy || childDirty" @pending="batchPending = $event" @changed="data.load" />
          <ul class="admin-list">
            <li v-for="task in data.data.value?.tasks" :key="task.id" class="admin-list-item" :class="{ 'is-selected': selected?.taskId === task.id }">
              <div class="console-row-head">
                <h3>{{ t(`page.academic.requestKinds.${task.submission.kind}`) }}</h3>
                <Tag :color="tagColor(task.state)">{{ t(`page.academic.taskStates.${task.state}`) }}</Tag>
              </div>
              <p v-if="task.submission.reason !== 'content_review'">{{ task.submission.reason.slice(0,120) }}</p>
              <p class="meta">{{ d(new Date(task.updated_at),'dateTime') }}</p>
              <Button type="link" size="small" :disabled="childBusy || batchPending" @click="open({taskId:task.id})">{{ t('page.academic.openItem') }}</Button>
            </li>
            <li v-for="entry in data.data.value?.entries" :key="entry.id" class="admin-list-item" :class="{ 'is-selected': selected?.entryId === entry.id }">
              <div class="console-row-head">
                <h3>{{ entry.input.title || t(`page.academic.kind.${entry.input.kind}`) }}</h3>
                <Tag :color="tagColor(entry.state)">{{ t(`page.academic.states.${entry.state}`) }}</Tag>
              </div>
              <p>{{ entry.input.body.slice(0,120) }}</p>
              <Button type="link" size="small" :disabled="childBusy || batchPending" @click="open({entryId:entry.id})">{{ t('page.academic.openItem') }}</Button>
            </li>
          </ul>
          <Space class="mt-3">
            <Button v-if="history.length > 0" :disabled="locked" @click="previous">{{ t('page.academic.previous') }}</Button>
            <Button v-if="data.data.value?.next" :disabled="locked" @click="next">{{ t('page.academic.next') }}</Button>
          </Space>
        </Card>
        <Empty v-if="!selected" class="console-placeholder" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.console.selectItem')" />
        <Card v-else class="console-detail" :bordered="false">
          <div ref="panel" tabindex="-1"><DecisionPanel :key="selected.taskId ?? selected.entryId" :school-id="school" :task-id="selected.taskId" :entry-id="selected.entryId" @pending="pending" @changed="data.load" @close="selected = undefined" /></div>
        </Card>
      </div>
    </div>
  </Page>
</template>
