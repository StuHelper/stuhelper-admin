<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {onBeforeRouteLeave} from 'vue-router';

import {useI18n} from '@vben/locales';

import { Alert, Button, Checkbox, CheckboxGroup, Collapse, CollapsePanel, List, ListItem, Select, Space, Tag, Textarea } from 'ant-design-vue';

import { confirmLeave } from '#/confirm-leave';
import { tagColor } from '#/console-ui';

import {AcademicError,type AdminEntry,type BatchPreview,type BatchRequest,call,type Decision,Mutation,type Task} from './api';
const props=defineProps<{disabled:boolean;tasks:Task[];}>();const emit=defineEmits<{changed:[];pending:[value:boolean]}>();const {t}=useI18n();
const selected=ref<string[]>([]);const action=ref<Decision['action']>('hide');const reason=ref('');const preview=ref<BatchPreview>();const request=ref<BatchRequest>();const busy=ref(false);const uncertain=ref(false);const error=ref('');const mutation=new Mutation();
const dirty=computed(()=>selected.value.length>0||reason.value.length>0);watch([selected,action,reason],()=>{preview.value=undefined;request.value=undefined},{deep:true});watch([busy,uncertain,dirty],()=>emit('pending',busy.value||uncertain.value||dirty.value));onBeforeUnmount(()=>emit('pending',false));onBeforeRouteLeave(()=>!(busy.value||uncertain.value||dirty.value)||confirmLeave(t('page.academic.unsavedChanges')));
async function inspect(){if(busy.value)return;busy.value=true;error.value='';try{const items:BatchRequest['items']=[];for(const id of selected.value){const task=props.tasks.find(item=>item.id===id);if(!task)throw new AcademicError('conflict');const entry=await call<AdminEntry>('reviews',`/admin/entries/${encodeURIComponent(task.submission.object_id)}`,'AdminEntry');items.push({id,revision:task.revision,decision:{id:'',object_id:entry.id,revision:entry.revision,action:action.value,reason:reason.value}})};const value={items,preview_token:''};preview.value=await call<BatchPreview>('moderation','/tasks/batch-preview','BatchPreview',{body:value,key:crypto.randomUUID()});request.value={...value,preview_token:preview.value.preview_token}}catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}finally{busy.value=false}}
async function apply(){if(!request.value||busy.value)return;busy.value=true;error.value='';try{preview.value=await mutation.run<BatchPreview>('moderation','/tasks/batch','BatchPreview',request.value);emit('changed')}catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}finally{busy.value=false;uncertain.value=mutation.uncertain}}
function reset(){selected.value=[];reason.value='';preview.value=undefined;request.value=undefined}
</script>
<template>
  <Collapse ghost class="mb-3">
    <CollapsePanel key="batch" :header="t('page.academic.batchTitle')">
      <div class="admin-form">
        <CheckboxGroup v-model:value="selected" class="grid gap-2" :disabled="disabled || busy || uncertain">
          <Checkbox v-for="task in tasks.filter(item=>item.state === 'waiting')" :key="task.id" :value="task.id" :disabled="!selected.includes(task.id) && selected.length >= 20">
            {{ t(`page.academic.requestKinds.${task.submission.kind}`) }} {{ task.submission.reason === 'content_review' ? t('page.academic.originalContent') : task.submission.reason }}
          </Checkbox>
        </CheckboxGroup>
        <label>{{ t('page.academic.moderationAction') }}
          <Select v-model:value="action" :disabled="disabled || busy || uncertain" :options="['publish','hide','restore','delete','feature','unfeature','dismiss'].map(value => ({ value, label: t(`page.academic.actions.${value}`) }))" />
        </label>
        <label>{{ t('page.academic.decisionReason') }}<Textarea v-model:value="reason" :maxlength="2000" :rows="3" :disabled="disabled || busy || uncertain" /></label>
        <Alert v-if="error" type="error" show-icon :message="t(`page.academic.errors.${error}`)" />
        <Alert v-if="uncertain" type="warning" show-icon :message="t('page.academic.uncertain')" />
        <List v-if="preview" size="small" bordered :data-source="preview.items">
          <template #renderItem="{ item }">
            <ListItem>{{ item.id }}<span><Tag :color="tagColor(item.state)">{{ t(`page.academic.operationStates.${item.state}`) }}</Tag><span v-if="item.code">{{ t(`page.academic.errors.${item.code}`) }}</span></span></ListItem>
          </template>
        </List>
        <Space wrap>
          <Button :disabled="disabled || busy || uncertain || selected.length === 0 || !reason.trim()" @click="inspect">{{ t('page.academic.previewBatch') }}</Button>
          <Button v-if="request" type="primary" :loading="busy" :disabled="disabled" @click="apply">{{ t(uncertain ? 'page.academic.retry' : 'page.academic.applyBatch') }}</Button>
          <Button :disabled="busy || uncertain" @click="reset">{{ t('page.academic.cancel') }}</Button>
        </Space>
      </div>
    </CollapsePanel>
  </Collapse>
</template>
