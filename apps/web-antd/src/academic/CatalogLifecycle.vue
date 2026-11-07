<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {onBeforeRouteLeave} from 'vue-router';

import {useI18n} from '@vben/locales';

import { Alert, Button, Descriptions, DescriptionsItem, Select, Space, Textarea } from 'ant-design-vue';

import { confirmLeave } from '#/confirm-leave';

import {AcademicError,type AcademicObject,call,type MergePreview,Mutation,objectOptions} from './api';
import StatusBlock from './StatusBlock.vue';
import {useLoad} from './useLoad';
const props=defineProps<{disabled:boolean;entry:AcademicObject;}>();
const emit=defineEmits<{complete:[id:string];pending:[value:boolean]}>();
const {t}=useI18n();const target=ref('');const reason=ref('');const busy=ref(false);const error=ref('');const uncertain=ref(false);const intent=ref<'merge'|'state'>('merge');const plan=ref<MergePreview>();
const targets=useLoad(signal=>objectOptions({kind:props.entry.kind,school_id:props.entry.school_id},signal));void targets.load();
const selected=computed(()=>targets.data.value?.items.find(item=>item.id===target.value));const mutation=new Mutation();
watch([target,reason],()=>{plan.value=undefined});watch([busy,reason,uncertain],()=>emit('pending',busy.value||uncertain.value||!!reason.value));onBeforeUnmount(()=>emit('pending',false));
onBeforeRouteLeave(()=>!(busy.value||uncertain.value||reason.value)||confirmLeave(t('page.academic.unsavedChanges')));
function request(){return {target_id:target.value,source_revision:props.entry.revision,target_revision:selected.value?.revision??0,reason:reason.value}}
async function preview(){busy.value=true;error.value='';try{plan.value=await call<MergePreview>('catalog',`/objects/${encodeURIComponent(props.entry.id)}/merge-preview`,'MergePreview',{body:request(),key:crypto.randomUUID()})}catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}finally{busy.value=false}}
async function apply(action:'merge'|'state'){
 if(busy.value)return;if(!uncertain.value)intent.value=action;busy.value=true;error.value='';
 try{const which=intent.value;const result=await mutation.run<AcademicObject>('catalog',`/objects/${encodeURIComponent(props.entry.id)}/${which}`,'Object',which==='merge'?{...request(),preview_token:plan.value?.preview_token}:{revision:props.entry.revision,inactive:!props.entry.inactive,reason:reason.value});reason.value='';emit('complete',result.id)}catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}finally{busy.value=false;uncertain.value=mutation.uncertain}
}
</script>
<template>
  <section class="admin-form">
    <h3>{{ t('page.academic.mergeTitle') }}</h3>
    <p class="meta">{{ t('page.academic.mergeHint') }}</p>
    <StatusBlock :busy="targets.busy.value" :error="targets.error.value" @retry="targets.load" />
    <label>{{ t('page.academic.mergeTarget') }}
      <Select v-model:value="target" show-search option-filter-prop="label" :disabled="disabled || busy || uncertain" :options="[{ value: '', label: t('page.academic.choose') }, ...(targets.data.value?.items ?? []).filter(item => item.id !== entry.id).map(item => ({ value: item.id, label: item.name }))]" />
    </label>
    <label>{{ t('page.academic.reason') }}<Textarea v-model:value="reason" :maxlength="2000" :rows="3" :disabled="disabled || busy || uncertain" /></label>
    <Alert v-if="plan" type="info" :message="t('page.academic.mergeHint')">
      <template #description>
        <Descriptions v-for="(record, index) in [plan.source, plan.target]" :key="record.id" size="small" :column="1" :title="`${index === 0 ? t('page.academic.mergeSource') : t('page.academic.mergeTarget')} ${record.name}`">
          <DescriptionsItem>{{ t('page.academic.revision',{value:record.revision}) }}</DescriptionsItem>
          <DescriptionsItem v-if="record.biography" :label="t('page.academic.biography')">{{ record.biography }}</DescriptionsItem>
          <DescriptionsItem v-if="record.credits != null" :label="t('page.academic.creditsLabel')">{{ t('page.academic.credits',{credits:record.credits}) }}</DescriptionsItem>
        </Descriptions>
      </template>
    </Alert>
    <Alert v-if="error" type="error" show-icon :message="t(`page.academic.errors.${error}`)" />
    <Alert v-if="uncertain" type="warning" show-icon :message="t('page.academic.uncertain')" />
    <Space wrap>
      <Button v-if="uncertain" type="primary" :loading="busy" @click="apply(intent)">{{ t('page.academic.retry') }}</Button>
      <template v-else>
        <Button :disabled="disabled || busy || !selected || !reason.trim()" @click="preview">{{ t('page.academic.previewMerge') }}</Button>
        <Button v-if="plan" type="primary" :disabled="disabled || busy" @click="apply('merge')">{{ t('page.academic.confirmMerge') }}</Button>
        <Button :danger="!entry.inactive" :disabled="disabled || busy || !reason.trim()" @click="apply('state')">{{ t(entry.inactive ? 'page.academic.enableObject' : 'page.academic.disableObject') }}</Button>
        <Button :disabled="busy" @click="reason = '';plan = undefined">{{ t('page.academic.cancel') }}</Button>
      </template>
    </Space>
  </section>
</template>
