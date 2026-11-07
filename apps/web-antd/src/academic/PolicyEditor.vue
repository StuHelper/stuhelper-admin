<script setup lang="ts">
import { computed,onBeforeUnmount,ref,watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Alert, Button, Select, Space, Tag, Textarea } from 'ant-design-vue';

import { confirmLeave } from '#/confirm-leave';

import { AcademicError,call,Mutation,type PolicyView,query } from './api';
import StatusBlock from './StatusBlock.vue';
import { useLoad } from './useLoad';
const props=defineProps<{schoolId:string}>();
const emit=defineEmits<{pending:[busy:boolean,dirty:boolean]}>();
const {t}=useI18n();
const busy=ref(false); const error=ref(''); const kind=ref('course'); const mode=ref('published'); const notice=ref(''); const revision=ref(0); const scope=ref(props.schoolId); const uncertain=ref(false); const words=ref('');
const mutation=new Mutation();
const baseline=ref('');
const form=()=>JSON.stringify([mode.value,words.value]);
const dirty=computed(()=>baseline.value!==''&&baseline.value!==form());
const data=useLoad(signal=>call<PolicyView>('moderation','/policies'+query({school_id:scope.value,kind:kind.value}),'PolicyView',{signal}));
async function load(preserve=false){await data.load();if(data.data.value){revision.value=data.data.value.configured?.revision??0;if(preserve){notice.value='compareNotice'}else {mode.value=data.data.value.effective.mode;words.value=data.data.value.effective.blocked_terms.join('\n');baseline.value=form()}}}
watch(()=>[props.schoolId,scope.value,kind.value],()=>{if(scope.value!=='*')scope.value=props.schoolId;error.value='';notice.value='';void load()},{immediate:true});
watch([busy,uncertain,dirty],()=>emit('pending',busy.value||uncertain.value,dirty.value),{immediate:true});
onBeforeUnmount(()=>emit('pending',false,false));
onBeforeRouteLeave(()=>!(dirty.value||busy.value||uncertain.value)||confirmLeave(t(uncertain.value?'page.academic.uncertain':'page.academic.unsavedChanges')));
function reset(){if(data.data.value){mode.value=data.data.value.effective.mode;words.value=data.data.value.effective.blocked_terms.join('\n');baseline.value=form();error.value=''}}
async function save(){
  if(busy.value)return;busy.value=true;error.value='';notice.value='';
  try{await mutation.run('moderation','/policies','Saved',{school_id:scope.value,kind:kind.value,mode:mode.value,blocked_terms:[...new Set(words.value.split('\n').map(v=>v.trim()).filter(Boolean))],revision:revision.value},'PUT');baseline.value=form();await load();notice.value='saved'}
  catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}
  finally{busy.value=false;uncertain.value=mutation.uncertain}
}
</script>
<template>
  <section class="admin-form">
    <h2>{{ t('page.academic.policyManagement') }}</h2>
    <div class="admin-filters">
      <label>{{ t('page.academic.policyScope') }}
        <Select v-model:value="scope" :disabled="busy || uncertain || dirty" :options="[{ value: schoolId, label: t('page.academic.school') }, { value: '*', label: t('page.academic.globalScope') }]" />
      </label>
      <label>{{ t('page.academic.contentKind') }}
        <Select v-model:value="kind" :disabled="busy || uncertain || dirty" :options="['course','mentor','reply'].map(value => ({ value, label: t(`page.academic.kind.${value}`) }))" />
      </label>
    </div>
    <StatusBlock :busy="data.busy.value" :error="data.error.value" @retry="load" />
    <form v-if="data.data.value" class="admin-form" @submit.prevent="save">
      <Tag class="justify-self-start">{{ t(`page.academic.policySources.${data.data.value.source}`) }}</Tag>
      <label>{{ t('page.academic.policyMode') }}
        <Select v-model:value="mode" :disabled="busy || uncertain" :options="['published','pending','review'].map(value => ({ value, label: t(`page.academic.policyModes.${value}`) }))" />
      </label>
      <label>{{ t('page.academic.blockedTerms') }}<Textarea v-model:value="words" :rows="8" :maxlength="10099" :disabled="busy || uncertain" /></label>
      <Alert v-if="error" type="error" show-icon :message="t(`page.academic.errors.${error}`)" />
      <Alert v-if="notice" type="success" show-icon :message="t(`page.academic.${notice}`)" />
      <Alert v-if="uncertain" type="warning" show-icon :message="t('page.academic.uncertain')" />
      <Space wrap>
        <Button type="primary" html-type="submit" :loading="busy">{{ t(uncertain ? 'page.academic.retry' : 'page.academic.savePolicy') }}</Button>
        <Button v-if="error === 'conflict'" :disabled="busy || uncertain" @click="load(true)">{{ t('page.academic.reloadCompare') }}</Button>
        <Button :disabled="busy || uncertain" @click="reset">{{ t('page.academic.cancel') }}</Button>
      </Space>
    </form>
  </section>
</template>
