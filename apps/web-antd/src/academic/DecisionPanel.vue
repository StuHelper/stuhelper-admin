<script setup lang="ts">
import { computed,onBeforeUnmount,onMounted,ref,watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

import { useI18n } from '@vben/locales';

import { AcademicError,type AdminEntry,call,type Decision,Mutation,type Task } from './api';
import StatusBlock from './StatusBlock.vue';
import { useLoad } from './useLoad';
const props=defineProps<{entryId?:string;schoolId:string;taskId?:string;}>();
const emit=defineEmits<{changed:[];close:[];pending:[busy:boolean,dirty:boolean]}>();
const {t,n}=useI18n();
const action=ref<Decision['action']>(); const body=ref(''); const busy=ref(false); const error=ref(''); const notice=ref(''); const reason=ref(''); const signed=ref(false); const task=ref<Task>(); const uncertain=ref(false);
const pollController=new AbortController();
const decisionMutation=new Mutation(); const retryMutation=new Mutation(); const taskMutation=new Mutation();
const baseline=ref(''); const form=()=>JSON.stringify([action.value,body.value,reason.value,signed.value]);
const dirty=computed(()=>baseline.value!==''&&baseline.value!==form());
const data=useLoad(async signal=>{
  const taskId=task.value?.id??props.taskId;
  const record=taskId?await call<Task>('moderation',`/tasks/${encodeURIComponent(taskId)}`,'TaskView',{signal}):undefined;
  const entryId=record?.submission.object_id??props.entryId;
  if(!entryId)throw new AcademicError('invalid_input');
  const entry=await call<AdminEntry>('reviews',`/admin/entries/${encodeURIComponent(entryId)}`,'AdminEntry',{signal});
  if(entry.school_id!==props.schoolId)throw new AcademicError('forbidden');
  return {entry,task:record};
});
async function load(preserve=false){
  await data.load();const result=data.data.value;
  if(!result)return;
  task.value=result.task;
  if(!preserve){action.value=undefined;body.value=result.task?.submission.proposed_body||result.entry.input.body;reason.value='';signed.value=!result.entry.anonymous;baseline.value=form()}
  else if(error.value==='conflict')notice.value='compareNotice';
}
watch(()=>[props.taskId,props.entryId,props.schoolId],()=>{task.value=undefined;error.value='';notice.value='';void load()},{immediate:true});
watch([busy,uncertain,dirty],()=>emit('pending',busy.value||uncertain.value,dirty.value),{immediate:true});
const actions=computed(()=>{
  const state=data.data.value?.entry.state;
  const values:Decision['action'][]=['edit','identity'];
  if(state==='pending')values.unshift('publish');
  if(state==='published')values.unshift('hide');
  if(state==='hidden'||state==='deleted')values.unshift('restore');
  if(state!=='deleted')values.push('delete');
  if(task.value)values.push('dismiss');
  return values;
});
function canLeave(){return !(dirty.value||busy.value||uncertain.value)||window.confirm(t(uncertain.value?'page.academic.uncertain':'page.academic.unsavedChanges'))}
onBeforeRouteLeave(canLeave);
function close(){if(canLeave())emit('close')}
let polling=false; let polls=0; let timer:ReturnType<typeof setInterval>|undefined;
onMounted(()=>{timer=setInterval(()=>{void poll()},3000)});
onBeforeUnmount(()=>{clearInterval(timer);pollController.abort();emit('pending',false,false)});
async function poll(){
  if(polling||busy.value||uncertain.value||task.value?.state!=='decided'||polls>=20)return;
  polling=true;polls++;
  try{const current=await call<Task>('moderation',`/tasks/${encodeURIComponent(task.value.id)}`,'TaskView',{signal:pollController.signal});task.value=current;if(current.state!=='decided'){notice.value=current.state==='applied'?'decisionApplied':'';await load(true);emit('changed')}}
  catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable';polls=20;if(['forbidden','unauthenticated'].includes(error.value)){data.data.value=undefined;emit('changed')}}
  finally{polling=false}
}
async function decide(){
  if(busy.value||!data.data.value||!action.value)return;
  busy.value=true;error.value='';notice.value='';
  try{
    const entry=data.data.value.entry;
    if(!task.value)task.value=await taskMutation.run<Task>('moderation','/tasks','TaskView',{object_id:entry.id,kind:'review',reason:reason.value,evidence:[]});
    const decision:Decision={id:'',object_id:entry.id,revision:entry.revision,action:action.value,signed:signed.value,reason:reason.value,...(action.value==='edit'?{body:body.value}:{}),...(action.value==='identity'?{author_handle:entry.author_handle}:{})};
    task.value=await decisionMutation.run<Task>('moderation',`/tasks/${encodeURIComponent(task.value.id)}/decisions`,'TaskView',{revision:task.value.revision,decision});
    baseline.value=form();polls=0;notice.value=task.value.state==='applied'?'decisionApplied':'decisionQueued';emit('changed');
  }catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}
  finally{busy.value=false;uncertain.value=taskMutation.uncertain||decisionMutation.uncertain}
}
async function retry(){
  if(!task.value||busy.value)return;busy.value=true;error.value='';
  try{task.value=await retryMutation.run<Task>('moderation',`/tasks/${encodeURIComponent(task.value.id)}/retry`,'TaskView',{revision:task.value.revision});polls=0;notice.value='decisionQueued';emit('changed')}
  catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}
  finally{busy.value=false;uncertain.value=retryMutation.uncertain}
}
const names=['recommendation','quality','difficulty','workload','grading'] as const;
</script>
<template>
  <section>
<div class="admin-actions"><button type="button" :disabled="busy || uncertain" @click="load(true)">{{ t('page.academic.reloadCompare') }}</button><button type="button" :disabled="busy" @click="close">{{ t('page.academic.cancel') }}</button></div><StatusBlock :busy="data.busy.value" :error="data.error.value" @retry="load(true)" />
    <template v-if="data.data.value">
<h2>{{ t('page.academic.originalContent') }}</h2><p>{{ t(`page.academic.kind.${data.data.value.entry.input.kind}`) }} {{ t(`page.academic.states.${data.data.value.entry.state}`) }}</p><p>{{ t('page.academic.revision',{value:n(data.data.value.entry.revision)}) }}</p><h3>{{ data.data.value.entry.input.title }}</h3><div class="admin-body">{{ data.data.value.entry.input.body }}</div><dl v-if="data.data.value.entry.input.kind === 'course'" class="admin-facts"><div v-for="(name,index) in names" :key="name"><dt>{{ t(`page.academic.ratings.${name}.label`) }}</dt><dd>{{ t(`page.academic.ratings.${name}.level${data.data.value.entry.input.ratings[index]}`) }}</dd></div></dl>
      <div v-if="task" class="admin-notice"><h3>{{ t(`page.academic.requestKinds.${task.submission.kind}`) }}</h3><p v-if="task.submission.reason !== 'content_review'">{{ task.submission.reason }}</p><p v-for="(item,index) in task.submission.evidence" :key="index">{{ item }}</p><p>{{ t(`page.academic.taskStates.${task.state}`) }}</p><p v-if="task.decision">{{ task.decision.reason }}</p><button v-if="task.state === 'failed' && task.error_code === 'unavailable'" :disabled="busy" @click="retry">{{ t('page.academic.retryDelivery') }}</button></div>
      <form v-if="!task || task.state === 'waiting' || (uncertain && !retryMutation.uncertain)" class="admin-form" @submit.prevent="decide"><fieldset :disabled="busy || uncertain"><label>{{ t('page.academic.moderationAction') }}<select v-model="action" required><option :value="undefined">{{ t('page.academic.choose') }}</option><option v-for="value in actions" :key="value" :value="value">{{ t(`page.academic.actions.${value}`) }}</option></select></label><label v-if="action === 'edit'">{{ t('page.academic.proposedBody') }}<textarea v-model="body" rows="10" maxlength="16000" required></textarea></label><template v-if="action === 'identity'"><p>{{ t('page.academic.wholeDiscussion') }}</p><label class="checkbox"><input v-model="signed" type="checkbox" />{{ t('page.academic.signed') }}</label></template><label>{{ t('page.academic.decisionReason') }}<textarea v-model="reason" rows="3" maxlength="2000" required></textarea></label></fieldset><button type="submit" :disabled="busy">{{ t(uncertain ? 'page.academic.retry' : 'page.academic.applyDecision') }}</button></form>
    </template>
    <p v-if="error" role="alert">{{ t(`page.academic.errors.${error}`) }}</p><p v-if="notice" role="status">{{ t(`page.academic.${notice}`) }}</p><p v-if="uncertain" role="status">{{ t('page.academic.uncertain') }}</p>
  </section>
</template>
