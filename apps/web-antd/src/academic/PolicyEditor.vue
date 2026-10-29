<script setup lang="ts">
import { computed,onBeforeUnmount,ref,watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

import { useI18n } from '@vben/locales';

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
onBeforeRouteLeave(()=>!(dirty.value||busy.value||uncertain.value)||window.confirm(t(uncertain.value?'page.academic.uncertain':'page.academic.unsavedChanges')));
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
<h2>{{ t('page.academic.policyManagement') }}</h2><div class="admin-filters"><label>{{ t('page.academic.policyScope') }}<select v-model="scope" :disabled="busy || uncertain || dirty"><option :value="schoolId">{{ t('page.academic.school') }}</option><option value="*">{{ t('page.academic.globalScope') }}</option></select></label><label>{{ t('page.academic.contentKind') }}<select v-model="kind" :disabled="busy || uncertain || dirty"><option v-for="item in ['course','mentor','reply']" :key="item" :value="item">{{ t(`page.academic.kind.${item}`) }}</option></select></label></div>
    <StatusBlock :busy="data.busy.value" :error="data.error.value" @retry="load" />
    <form v-if="data.data.value" class="admin-form" @submit.prevent="save"><p>{{ t(`page.academic.policySources.${data.data.value.source}`) }}</p><fieldset :disabled="busy || uncertain"><label>{{ t('page.academic.policyMode') }}<select v-model="mode"><option v-for="item in ['published','pending','review']" :key="item" :value="item">{{ t(`page.academic.policyModes.${item}`) }}</option></select></label><label>{{ t('page.academic.blockedTerms') }}<textarea v-model="words" rows="8" maxlength="10099"></textarea></label></fieldset><p v-if="error" role="alert">{{ t(`page.academic.errors.${error}`) }}</p><p v-if="notice" role="status">{{ t(`page.academic.${notice}`) }}</p><p v-if="uncertain" role="status">{{ t('page.academic.uncertain') }}</p><div class="admin-actions"><button type="submit" :disabled="busy">{{ t(uncertain ? 'page.academic.retry' : 'page.academic.savePolicy') }}</button><button v-if="error === 'conflict'" type="button" :disabled="busy || uncertain" @click="load(true)">{{ t('page.academic.reloadCompare') }}</button><button type="button" :disabled="busy || uncertain" @click="reset">{{ t('page.academic.cancel') }}</button></div></form>
  </section>
</template>
