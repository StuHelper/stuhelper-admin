<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Checkbox, Collapse, CollapsePanel, Divider, Empty, Input, InputNumber, Select, Space, Tag, Textarea } from 'ant-design-vue';

import { confirmLeave } from '#/confirm-leave';
import { rememberedSchool,rememberSchool } from '#/console-ui';

import { AcademicError,type Correction,Mutation,objectOptions,objects,summary } from './api';
import CatalogLifecycle from './CatalogLifecycle.vue';
import ImportPanel from './ImportPanel.vue';
import StatusBlock from './StatusBlock.vue';
import { useLoad } from './useLoad';

import './console.css';
const {t,d,n}=useI18n();
const operationPending=ref(false);const importPending=ref(false);
const after=ref(''); const history=ref<string[]>([]); const kind=ref('course'); const school=ref(''); const search=ref(''); const selectedId=ref('');
const biography=ref(''); const busy=ref(false); const category=ref(''); const code=ref(''); const credits=ref(''); const department=ref(''); const error=ref(''); const name=ref(''); const nature=ref(''); const notice=ref(''); const uncertain=ref(false); const unknownCredits=ref(true);
const baseline=ref(''); const form=()=>JSON.stringify([name.value,biography.value,department.value,category.value,nature.value,code.value,credits.value,unknownCredits.value]);
const dirty=computed(()=>baseline.value!==''&&baseline.value!==form());
const mutation=new Mutation();
const schools=useLoad(signal=>objectOptions({kind:'school'},signal));
const directory=useLoad(signal=>objects({kind:kind.value,school_id:school.value,q:search.value,after:after.value,include_inactive:'true'},signal));
const options=useLoad(async signal=>{const [departments,categories,natures]=await Promise.all([objectOptions({kind:'department',school_id:school.value},signal),objectOptions({kind:'category',school_id:school.value},signal),objectOptions({kind:'nature',school_id:school.value},signal)]);return {departments:departments.items,categories:categories.items,natures:natures.items}});
const selected=useLoad(async signal=>{const data=await summary(selectedId.value,signal);if(data.object.school_id!==school.value)throw new AcademicError('forbidden');return data});
void schools.load();
watch(()=>schools.data.value,rows=>{if(rows&&!school.value)school.value=rememberedSchool(rows.items.map(item=>item.id))});
watch(school,rememberSchool);
watch([school,kind],()=>{after.value='';history.value=[];selectedId.value='';baseline.value='';if(school.value){void options.load();void directory.load()}},{immediate:true});
async function canLeave(){return !(dirty.value||busy.value||uncertain.value)||confirmLeave(t(uncertain.value?'page.academic.uncertain':'page.academic.unsavedChanges'))}
onBeforeRouteLeave(canLeave);
const locked=computed(()=>busy.value||uncertain.value||dirty.value||operationPending.value||importPending.value);
function apply(){if(busy.value||uncertain.value||dirty.value)return;after.value='';history.value=[];void directory.load()}
async function open(id:string,preserve=false,confirmed=false){
  if(!preserve&&!confirmed&&!(await canLeave()))return;
  selectedId.value=id;error.value='';notice.value='';await selected.load();
  const entry=selected.data.value?.object;
  if(!entry)return;
  if(preserve){notice.value='compareNotice';}
  else {name.value=entry.name;biography.value=entry.biography??'';department.value=entry.department_id??'';category.value=entry.category_id??'';nature.value=entry.nature_id??'';code.value=entry.code??'';credits.value=entry.credits===null?'':String(entry.credits);unknownCredits.value=entry.credits===null;baseline.value=form()}
}
async function close(){if(await canLeave()){selectedId.value='';baseline.value='';error.value='';notice.value=''}}
async function save(){
  if(busy.value||!selected.data.value)return;
  busy.value=true;error.value='';notice.value='';
  try{
    const entry=selected.data.value.object;
    const correction:Correction={revision:entry.revision,name:name.value,biography:biography.value,department_id:department.value,...(entry.kind==='course'?{code:code.value,category_id:category.value,nature_id:nature.value,clear_credits:unknownCredits.value,...(unknownCredits.value?{}:{credits:Number(credits.value)})}:{})};
    await mutation.run('catalog',`/objects/${encodeURIComponent(entry.id)}`,'Object',correction,'PATCH');baseline.value=form();await open(entry.id,false,true);notice.value='saved';void directory.load();
  }catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}
  finally{busy.value=false;uncertain.value=mutation.uncertain}
}
function next(){if(directory.data.value?.next){history.value.push(after.value);after.value=directory.data.value.next;void directory.load()}}
function previous(){after.value=history.value.pop()??'';void directory.load()}
</script>
<template>
  <Page :title="t('page.academic.catalogTitle')" :description="t('page.academic.catalogIntro')">
    <div class="academic-console">
      <Card :bordered="false">
        <form class="admin-filters" @submit.prevent="apply">
          <label>{{ t('page.academic.school') }}
            <Select v-model:value="school" :disabled="locked" :options="[{ value: '', label: t('page.academic.choose') }, ...(schools.data.value?.items ?? []).map(item => ({ value: item.id, label: item.name }))]" />
          </label>
          <label>{{ t('page.academic.contentKind') }}
            <Select v-model:value="kind" :disabled="locked" :options="[{ value: 'course', label: t('page.academic.courses') }, { value: 'teacher', label: t('page.academic.teachers') }]" />
          </label>
          <label>{{ t('page.academic.search') }}<Input v-model:value="search" type="search" :maxlength="200" allow-clear :disabled="locked" /></label>
          <Button type="primary" html-type="submit" :disabled="locked || !school">{{ t('page.academic.filter') }}</Button>
        </form>
        <StatusBlock :busy="schools.busy.value" :error="schools.error.value" @retry="schools.load" />
        <Alert v-if="!school" type="info" show-icon :message="t('page.academic.selectSchool')" />
      </Card>
      <div v-if="school" class="admin-columns">
        <Card :bordered="false">
          <StatusBlock :busy="directory.busy.value" :error="directory.error.value" :empty="directory.data.value?.items.length === 0" @retry="directory.load" />
          <ul class="admin-list">
            <li v-for="entry in directory.data.value?.items" :key="entry.id" class="admin-list-item" :class="{ 'is-selected': selectedId === entry.id }">
              <div class="console-row-head"><h3>{{ entry.name }}</h3><Tag v-if="entry.inactive">{{ t('page.academic.inactive') }}</Tag></div>
              <p v-if="entry.kind === 'course'" class="meta">{{ entry.code }}</p>
              <Button type="link" size="small" :disabled="busy || uncertain || operationPending || importPending" @click="open(entry.id)">{{ t('page.academic.openItem') }}</Button>
            </li>
          </ul>
          <Space class="mt-3">
            <Button v-if="history.length > 0" :disabled="locked" @click="previous">{{ t('page.academic.previous') }}</Button>
            <Button v-if="directory.data.value?.next" :disabled="locked" @click="next">{{ t('page.academic.next') }}</Button>
          </Space>
        </Card>
        <Empty v-if="!selectedId" class="console-placeholder" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.console.selectItem')" />
        <Card v-else class="console-detail" :bordered="false">
          <StatusBlock :busy="selected.busy.value || options.busy.value" :error="selected.error.value || options.error.value" @retry="open(selectedId,true)" />
          <template v-if="selected.data.value">
            <div class="console-row-head"><h2>{{ selected.data.value.object.name }}</h2><Tag v-if="selected.data.value.object.inactive">{{ t('page.academic.inactive') }}</Tag></div>
            <Space class="meta" wrap><span>{{ selected.data.value.school.name }}</span><span>{{ t('page.academic.revision',{value:n(selected.data.value.object.revision)}) }}</span><span>{{ d(new Date(selected.data.value.object.updated_at),'dateTime') }}</span></Space>
            <Alert v-if="notice === 'compareNotice'" type="info" class="mb-3" :message="t('page.academic.originalContent')">
              <template #description>
                <p>{{ selected.data.value.object.name }}</p>
                <p class="admin-body">{{ selected.data.value.object.biography }}</p>
                <p v-if="kind === 'course'">{{ selected.data.value.object.credits === null ? t('page.academic.unknownCredits') : t('page.academic.credits',{credits:n(selected.data.value.object.credits)}) }}</p>
              </template>
            </Alert>
            <form class="admin-form" @submit.prevent="save">
              <label>{{ t('page.academic.recordName') }}<Input v-model:value="name" :maxlength="256" required :disabled="busy || uncertain" /></label>
              <label>{{ t('page.academic.biography') }}<Textarea v-model:value="biography" :rows="7" :maxlength="8000" :disabled="busy || uncertain" /></label>
              <label>{{ t(kind === 'course' ? 'page.academic.college' : 'page.academic.department') }}
                <Select v-model:value="department" :disabled="busy || uncertain" :options="[{ value: '', label: t('page.academic.unknown') }, ...(options.data.value?.departments ?? []).map(item => ({ value: item.id, label: item.name }))]" />
              </label>
              <template v-if="kind === 'course'">
                <label>{{ t('page.academic.code') }}<Input v-model:value="code" :maxlength="128" :disabled="busy || uncertain" /></label>
                <Checkbox v-model:checked="unknownCredits" :disabled="busy || uncertain">{{ t('page.academic.unknownCreditsToggle') }}</Checkbox>
                <label>{{ t('page.academic.creditsLabel') }}<InputNumber v-model:value="credits" string-mode :min="0" :max="100" class="w-full" :disabled="busy || uncertain || unknownCredits" /></label>
                <label>{{ t('page.academic.category') }}
                  <Select v-model:value="category" :disabled="busy || uncertain" :options="[{ value: '', label: t('page.academic.unknown') }, ...(options.data.value?.categories ?? []).map(item => ({ value: item.id, label: item.name }))]" />
                </label>
                <label>{{ t('page.academic.nature') }}
                  <Select v-model:value="nature" :disabled="busy || uncertain" :options="[{ value: '', label: t('page.academic.unknown') }, ...(options.data.value?.natures ?? []).map(item => ({ value: item.id, label: item.name }))]" />
                </label>
              </template>
              <Alert v-if="error" type="error" show-icon :message="t(`page.academic.errors.${error}`)" />
              <Alert v-if="notice" type="success" show-icon :message="t(`page.academic.${notice}`)" />
              <Alert v-if="uncertain" type="warning" show-icon :message="t('page.academic.uncertain')" />
              <Space wrap>
                <Button type="primary" html-type="submit" :loading="busy" :disabled="!name.trim() || (!unknownCredits && kind === 'course' && credits === '')">{{ t(uncertain ? 'page.academic.retry' : 'page.academic.saveChanges') }}</Button>
                <Button v-if="error === 'conflict'" :disabled="busy || uncertain || operationPending || importPending" @click="open(selectedId,true)">{{ t('page.academic.reloadCompare') }}</Button>
                <Button :disabled="busy" @click="close">{{ t('page.academic.cancel') }}</Button>
              </Space>
            </form>
            <Divider />
            <CatalogLifecycle :key="`${selected.data.value.object.id}-${selected.data.value.object.revision}`" :entry="selected.data.value.object" :disabled="busy || uncertain || dirty" @pending="operationPending = $event" @complete="open($event,false,true);directory.load()" />
          </template>
        </Card>
      </div>
      <Collapse v-if="school" class="console-collapse">
        <CollapsePanel key="import" :header="t('page.academic.importTitle')">
          <ImportPanel :school-id="school" :disabled="busy || uncertain || dirty || operationPending" @pending="importPending = $event" @complete="directory.load" />
        </CollapsePanel>
      </Collapse>
    </div>
  </Page>
</template>
