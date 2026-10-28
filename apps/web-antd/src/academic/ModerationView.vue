<script setup lang="ts">
import { computed,nextTick,ref,watch } from 'vue';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Card } from 'ant-design-vue';

import { type AdminPage,call,objectOptions,query,type Task } from './api';
import DecisionPanel from './DecisionPanel.vue';
import PolicyEditor from './PolicyEditor.vue';
import StatusBlock from './StatusBlock.vue';
import { useLoad } from './useLoad';

import './console.css';
const {t,d}=useI18n();
const after=ref(''); const history=ref<string[]>([]); const kind=ref(''); const school=ref(''); const state=ref('waiting'); const tab=ref('queue');
const childBusy=ref(false); const childDirty=ref(false); const panel=ref<HTMLElement>(); const selected=ref<{entryId?:string;taskId?:string;}>();
const schools=useLoad(signal=>objectOptions({kind:'school'},signal));
const data=useLoad(async signal=>{
  if(!school.value||tab.value==='policyManagement')return {tasks:[],entries:[],next:''};
  if(tab.value==='queue'){
    const tasks=await call<Task[]>('moderation','/tasks'+query({admin:'true',school_id:school.value,state:state.value,after:after.value,limit:'20'}),'TaskView',{signal,array:true});
    return {tasks,entries:[],next:tasks.length===20?tasks.at(-1)?.id??'':''};
  }
  const page=await call<AdminPage>('reviews','/admin/entries'+query({school_id:school.value,kind:kind.value,state:state.value,after:after.value,limit:'20'}),'AdminPage',{signal});
  return {tasks:[],entries:page.items,next:page.next};
});
watch(()=>schools.data.value,rows=>{if(rows?.items.length===1&&!school.value)school.value=rows.items[0]?.id??''});
void schools.load();
watch([tab,school],()=>{selected.value=undefined;childDirty.value=false;state.value=tab.value==='queue'?'waiting':'';kind.value='';after.value='';history.value=[];void data.load()},{immediate:true});
const empty=computed(()=>!!data.data.value&&data.data.value.tasks.length === 0&&data.data.value.entries.length === 0);
function apply(){if(childBusy.value||childDirty.value)return;after.value='';history.value=[];selected.value=undefined;void data.load()}
function next(){if(data.data.value?.next){history.value.push(after.value);after.value=data.data.value.next;void data.load()}}
function previous(){after.value=history.value.pop()??'';void data.load()}
async function open(value:{entryId?:string;taskId?:string;}){if(childBusy.value)return;if(childDirty.value&&!window.confirm(t('page.academic.unsavedChanges')))return;selected.value=value;await nextTick();panel.value?.focus();panel.value?.scrollIntoView({behavior:'smooth',block:'start'})}
function pending(busy:boolean,dirty:boolean){childBusy.value=busy;childDirty.value=dirty}
</script>
<template>
  <Page :title="t('page.academic.adminTitle')" :description="t('page.academic.adminIntro')">
    <div class="academic-console">
<Card :bordered="false"><nav class="admin-tabs" :aria-label="t('page.academic.adminTitle')"><button v-for="item in ['queue','contentManagement','policyManagement']" :key="item" :aria-pressed="tab === item" :disabled="childBusy || childDirty" @click="tab = item">{{ t(`page.academic.${item}`) }}</button></nav><form class="admin-filters" @submit.prevent="apply"><label>{{ t('page.academic.school') }}<select v-model="school" :disabled="childBusy || childDirty"><option value="">{{ t('page.academic.choose') }}</option><option v-for="item in schools.data.value?.items" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><template v-if="tab !== 'policyManagement'"><label>{{ t('page.academic.status') }}<select v-model="state" :disabled="childBusy || childDirty"><option value="">{{ t('page.academic.all') }}</option><option v-for="value in tab === 'queue' ? ['waiting','decided','applied','failed'] : ['pending','published','hidden','deleted']" :key="value" :value="value">{{ t(`page.academic.${tab === 'queue' ? 'taskStates' : 'states'}.${value}`) }}</option></select></label><label v-if="tab === 'contentManagement'">{{ t('page.academic.contentKind') }}<select v-model="kind" :disabled="childBusy || childDirty"><option value="">{{ t('page.academic.all') }}</option><option v-for="value in ['course','mentor','reply']" :key="value" :value="value">{{ t(`page.academic.kind.${value}`) }}</option></select></label><button type="submit" :disabled="childBusy || childDirty || !school">{{ t('page.academic.filter') }}</button></template></form><StatusBlock :busy="schools.busy.value" :error="schools.error.value" @retry="schools.load" /><p v-if="!school">{{ t('page.academic.selectSchool') }}</p></Card>
      <Card v-if="school && tab === 'policyManagement'" :bordered="false"><PolicyEditor :school-id="school" @pending="pending" /></Card>
      <div v-else-if="school" class="admin-columns"><Card :bordered="false"><StatusBlock :busy="data.busy.value" :error="data.error.value" :empty="empty" @retry="data.load" /><ul class="admin-list"><li v-for="task in data.data.value?.tasks" :key="task.id" class="admin-list-item"><h3>{{ t(`page.academic.requestKinds.${task.submission.kind}`) }}</h3><p v-if="task.submission.reason !== 'content_review'">{{ task.submission.reason.slice(0,120) }}</p><p class="meta">{{ t(`page.academic.taskStates.${task.state}`) }} {{ d(new Date(task.updated_at),'dateTime') }}</p><button :disabled="childBusy" @click="open({taskId:task.id})">{{ t('page.academic.openItem') }}</button></li><li v-for="entry in data.data.value?.entries" :key="entry.id" class="admin-list-item"><h3>{{ entry.input.title || t(`page.academic.kind.${entry.input.kind}`) }}</h3><p>{{ entry.input.body.slice(0,120) }}</p><p class="meta">{{ t(`page.academic.states.${entry.state}`) }}</p><button :disabled="childBusy" @click="open({entryId:entry.id})">{{ t('page.academic.openItem') }}</button></li></ul><div class="admin-actions"><button v-if="history.length > 0" :disabled="childBusy || childDirty" @click="previous">{{ t('page.academic.previous') }}</button><button v-if="data.data.value?.next" :disabled="childBusy || childDirty" @click="next">{{ t('page.academic.next') }}</button></div></Card><Card v-if="selected" :bordered="false"><div ref="panel" tabindex="-1"><DecisionPanel :key="selected.taskId ?? selected.entryId" :school-id="school" :task-id="selected.taskId" :entry-id="selected.entryId" @pending="pending" @changed="data.load" @close="selected = undefined" /></div></Card></div>
    </div>
  </Page>
</template>
