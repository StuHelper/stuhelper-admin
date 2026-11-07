<script setup lang="ts">
import {onBeforeUnmount,ref,watch} from 'vue';
import {onBeforeRouteLeave} from 'vue-router';

import {useI18n} from '@vben/locales';

import { Alert, Button, List, ListItem, Tag, Upload } from 'ant-design-vue';

import { confirmLeave } from '#/confirm-leave';

import {AcademicError,call,type CatalogImport,type ImportPreview,Mutation,parseCatalogImport} from './api';
const props=defineProps<{disabled:boolean;schoolId:string;}>();const emit=defineEmits<{complete:[];pending:[value:boolean]}>();const {t}=useI18n();
const input=ref<CatalogImport>();const preview=ref<ImportPreview>();const error=ref('');const busy=ref(false);const uncertain=ref(false);const saved=ref(false);const mutation=new Mutation();let generation=0;
watch(()=>props.schoolId,()=>{generation++;input.value=undefined;preview.value=undefined;error.value=''});watch([busy,uncertain],()=>emit('pending',busy.value||uncertain.value));onBeforeUnmount(()=>{generation++;emit('pending',false)});onBeforeRouteLeave(()=>!uncertain.value&&!busy.value||confirmLeave(t('page.academic.uncertain')));
const fileName=ref('');
// Upload only hands the chosen file to the parser; returning false keeps antd from sending it anywhere.
function choose(file:File){void read(file);return false}
async function read(file:File){const version=++generation;error.value='';preview.value=undefined;input.value=undefined;saved.value=false;fileName.value=file.name;try{if(file.size>4*1024*1024)throw new AcademicError('invalid_input');const value=parseCatalogImport(await file.text());if(version!==generation)return;if(value.school_id!==props.schoolId)throw new AcademicError('forbidden');input.value=value}catch(error_){if(version===generation)error.value=error_ instanceof AcademicError?error_.code:'invalid_input'}}
async function inspect(){if(!input.value)return;busy.value=true;error.value='';try{preview.value=await call<ImportPreview>('catalog','/imports/preview','ImportPreview',{body:input.value,key:crypto.randomUUID()})}catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}finally{busy.value=false}}
async function confirm(){if(!input.value||!preview.value||busy.value)return;busy.value=true;error.value='';try{await mutation.run('catalog','/imports/confirm','ImportResult',{...input.value,preview_token:preview.value.preview_token});saved.value=true;preview.value=undefined;input.value=undefined;emit('complete')}catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable';if(error.value==='conflict')preview.value=undefined}finally{busy.value=false;uncertain.value=mutation.uncertain}}
</script>
<template>
  <section class="admin-form">
    <Upload accept="application/json,.json" :max-count="1" :show-upload-list="false" :disabled="disabled || busy || uncertain" :before-upload="choose">
      <Button :disabled="disabled || busy || uncertain">{{ t('page.academic.importFile') }}</Button>
    </Upload>
    <span v-if="fileName" class="meta">{{ fileName }}</span>
    <Button class="justify-self-start" :loading="busy" :disabled="disabled || uncertain || !input" @click="inspect">{{ t('page.academic.previewImport') }}</Button>
    <Alert v-if="error" type="error" show-icon :message="t(`page.academic.errors.${error}`)" />
    <Alert v-if="saved" type="success" show-icon :message="t('page.academic.saved')" />
    <template v-if="preview">
      <Alert v-if="preview.code" type="error" show-icon :message="t(`page.academic.errors.${preview.code}`)" />
      <List size="small" bordered :data-source="preview.changes">
        <template #renderItem="{ item: row }">
          <ListItem><span>{{ row.id }}</span><Tag>{{ t(`page.academic.operationStates.${row.state}`) }}</Tag><span v-if="row.fields.length > 0" class="meta">{{ row.fields.join(', ') }}</span></ListItem>
        </template>
      </List>
      <Button type="primary" class="justify-self-start" :loading="busy" :disabled="disabled || !preview.valid" @click="confirm">{{ t(uncertain ? 'page.academic.retry' : 'page.academic.confirmImport') }}</Button>
    </template>
    <Alert v-if="uncertain" type="warning" show-icon :message="t('page.academic.uncertain')" />
  </section>
</template>
