<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {onBeforeRouteLeave} from 'vue-router';

import {useI18n} from '@vben/locales';

import {AcademicError,type AcademicObject,call,type MergePreview,Mutation,objectOptions} from './api';
import StatusBlock from './StatusBlock.vue';
import {useLoad} from './useLoad';
const props=defineProps<{disabled:boolean;entry:AcademicObject;}>();
const emit=defineEmits<{complete:[id:string];pending:[value:boolean]}>();
const {t}=useI18n();const target=ref('');const reason=ref('');const busy=ref(false);const error=ref('');const uncertain=ref(false);const intent=ref<'merge'|'state'>('merge');const plan=ref<MergePreview>();
const targets=useLoad(signal=>objectOptions({kind:props.entry.kind,school_id:props.entry.school_id},signal));void targets.load();
const selected=computed(()=>targets.data.value?.items.find(item=>item.id===target.value));const mutation=new Mutation();
watch([target,reason],()=>{plan.value=undefined});watch([busy,reason,uncertain],()=>emit('pending',busy.value||uncertain.value||!!reason.value));onBeforeUnmount(()=>emit('pending',false));
onBeforeRouteLeave(()=>!(busy.value||uncertain.value||reason.value)||window.confirm(t('page.academic.unsavedChanges')));
function request(){return {target_id:target.value,source_revision:props.entry.revision,target_revision:selected.value?.revision??0,reason:reason.value}}
async function preview(){busy.value=true;error.value='';try{plan.value=await call<MergePreview>('catalog',`/objects/${encodeURIComponent(props.entry.id)}/merge-preview`,'MergePreview',{body:request(),key:crypto.randomUUID()})}catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}finally{busy.value=false}}
async function apply(action:'merge'|'state'){
 if(busy.value)return;if(!uncertain.value)intent.value=action;busy.value=true;error.value='';
 try{const which=intent.value;const result=await mutation.run<AcademicObject>('catalog',`/objects/${encodeURIComponent(props.entry.id)}/${which}`,'Object',which==='merge'?{...request(),preview_token:plan.value?.preview_token}:{revision:props.entry.revision,inactive:!props.entry.inactive,reason:reason.value});reason.value='';emit('complete',result.id)}catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}finally{busy.value=false;uncertain.value=mutation.uncertain}
}
</script>
<template>
 <section class="admin-form">
<h3>{{ t('page.academic.mergeTitle') }}</h3><p>{{ t('page.academic.mergeHint') }}</p><StatusBlock :busy="targets.busy.value" :error="targets.error.value" @retry="targets.load" />
 <fieldset :disabled="disabled || busy || uncertain"><label>{{ t('page.academic.mergeTarget') }}<select v-model="target"><option value="">{{ t('page.academic.choose') }}</option><option v-for="item in targets.data.value?.items.filter(item=>item.id !== entry.id)" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><label>{{ t('page.academic.reason') }}<textarea v-model="reason" maxlength="2000" rows="3"></textarea></label></fieldset>
 <div v-if="plan" class="admin-notice"><article v-for="(record, index) in [plan.source, plan.target]" :key="record.id"><h4>{{ index === 0 ? t('page.academic.mergeSource') : t('page.academic.mergeTarget') }} {{ record.name }}</h4><p>{{ t('page.academic.revision',{value:record.revision}) }}</p><p v-if="record.biography">{{ record.biography }}</p><p v-if="record.credits != null">{{ t('page.academic.credits',{credits:record.credits}) }}</p></article><p>{{ t('page.academic.mergeHint') }}</p></div>
 <p v-if="error" role="alert">{{ t(`page.academic.errors.${error}`) }}</p><p v-if="uncertain" role="status">{{ t('page.academic.uncertain') }}</p>
 <div class="admin-actions"><button v-if="uncertain" :disabled="busy" @click="apply(intent)">{{ t('page.academic.retry') }}</button><template v-else><button :disabled="disabled || busy || !selected || !reason.trim()" @click="preview">{{ t('page.academic.previewMerge') }}</button><button v-if="plan" :disabled="disabled || busy" @click="apply('merge')">{{ t('page.academic.confirmMerge') }}</button><button :disabled="disabled || busy || !reason.trim()" @click="apply('state')">{{ t(entry.inactive ? 'page.academic.enableObject' : 'page.academic.disableObject') }}</button><button :disabled="busy" @click="reason = '';plan = undefined">{{ t('page.academic.cancel') }}</button></template></div>
 </section>
</template>
