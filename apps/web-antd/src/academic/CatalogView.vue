<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Card } from 'ant-design-vue';

import { AcademicError,type Correction,Mutation,objectOptions,objects,summary } from './api';
import StatusBlock from './StatusBlock.vue';
import { useLoad } from './useLoad';

import './console.css';
const {t,d,n}=useI18n();
const after=ref(''); const history=ref<string[]>([]); const kind=ref('course'); const school=ref(''); const search=ref(''); const selectedId=ref('');
const biography=ref(''); const busy=ref(false); const category=ref(''); const code=ref(''); const credits=ref(''); const department=ref(''); const error=ref(''); const name=ref(''); const nature=ref(''); const notice=ref(''); const uncertain=ref(false); const unknownCredits=ref(true);
const baseline=ref(''); const form=()=>JSON.stringify([name.value,biography.value,department.value,category.value,nature.value,code.value,credits.value,unknownCredits.value]);
const dirty=computed(()=>baseline.value!==''&&baseline.value!==form());
const mutation=new Mutation();
const schools=useLoad(signal=>objectOptions({kind:'school'},signal));
const directory=useLoad(signal=>objects({kind:kind.value,school_id:school.value,q:search.value,after:after.value},signal));
const options=useLoad(async signal=>{const [departments,categories,natures]=await Promise.all([objectOptions({kind:'department',school_id:school.value},signal),objectOptions({kind:'category',school_id:school.value},signal),objectOptions({kind:'nature',school_id:school.value},signal)]);return {departments:departments.items,categories:categories.items,natures:natures.items}});
const selected=useLoad(async signal=>{const data=await summary(selectedId.value,signal);if(data.object.school_id!==school.value)throw new AcademicError('forbidden');return data});
void schools.load();
watch(()=>schools.data.value,rows=>{if(rows?.items.length===1&&!school.value)school.value=rows.items[0]?.id??''});
watch([school,kind],()=>{after.value='';history.value=[];selectedId.value='';baseline.value='';if(school.value){void options.load();void directory.load()}},{immediate:true});
function canLeave(){return !(dirty.value||busy.value||uncertain.value)||window.confirm(t(uncertain.value?'page.academic.uncertain':'page.academic.unsavedChanges'))}
onBeforeRouteLeave(canLeave);
function apply(){if(busy.value||uncertain.value||dirty.value)return;after.value='';history.value=[];void directory.load()}
async function open(id:string,preserve=false,confirmed=false){
  if(!preserve&&!confirmed&&!canLeave())return;
  selectedId.value=id;error.value='';notice.value='';await selected.load();
  const entry=selected.data.value?.object;
  if(!entry)return;
  if(preserve){notice.value='compareNotice';}
  else {name.value=entry.name;biography.value=entry.biography??'';department.value=entry.department_id??'';category.value=entry.category_id??'';nature.value=entry.nature_id??'';code.value=entry.code??'';credits.value=entry.credits===null?'':String(entry.credits);unknownCredits.value=entry.credits===null;baseline.value=form()}
}
function close(){if(canLeave()){selectedId.value='';baseline.value='';error.value='';notice.value=''}}
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
    <Card :bordered="false"><form class="admin-filters" @submit.prevent="apply"><label>{{ t('page.academic.school') }}<select v-model="school" :disabled="busy || uncertain || dirty"><option value="">{{ t('page.academic.choose') }}</option><option v-for="item in schools.data.value?.items" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><label>{{ t('page.academic.contentKind') }}<select v-model="kind" :disabled="busy || uncertain || dirty"><option value="course">{{ t('page.academic.courses') }}</option><option value="teacher">{{ t('page.academic.teachers') }}</option></select></label><label>{{ t('page.academic.search') }}<input v-model="search" type="search" maxlength="200" :disabled="busy || uncertain || dirty" /></label><button type="submit" :disabled="busy || uncertain || dirty || !school">{{ t('page.academic.filter') }}</button></form><StatusBlock :busy="schools.busy.value" :error="schools.error.value" @retry="schools.load" /><p v-if="!school">{{ t('page.academic.selectSchool') }}</p></Card>
    <div v-if="school" class="admin-columns">
<Card :bordered="false"><StatusBlock :busy="directory.busy.value" :error="directory.error.value" :empty="directory.data.value?.items.length === 0" @retry="directory.load" /><ul class="admin-list"><li v-for="entry in directory.data.value?.items" :key="entry.id" class="admin-list-item"><h3>{{ entry.name }}</h3><p v-if="entry.kind === 'course'">{{ entry.code }}</p><button :disabled="busy || uncertain" @click="open(entry.id)">{{ t('page.academic.openItem') }}</button></li></ul><div class="admin-actions"><button v-if="history.length > 0" :disabled="busy || uncertain || dirty" @click="previous">{{ t('page.academic.previous') }}</button><button v-if="directory.data.value?.next" :disabled="busy || uncertain || dirty" @click="next">{{ t('page.academic.next') }}</button></div></Card>
      <Card v-if="selectedId" :bordered="false">
<StatusBlock :busy="selected.busy.value || options.busy.value" :error="selected.error.value || options.error.value" @retry="open(selectedId,true)" /><template v-if="selected.data.value">
<h2>{{ selected.data.value.object.name }}</h2><p>{{ selected.data.value.school.name }} {{ t('page.academic.revision',{value:n(selected.data.value.object.revision)}) }}</p><p>{{ d(new Date(selected.data.value.object.updated_at),'dateTime') }}</p><div v-if="notice === 'compareNotice'" class="admin-notice"><h3>{{ t('page.academic.originalContent') }}</h3><p>{{ selected.data.value.object.name }}</p><p class="admin-body">{{ selected.data.value.object.biography }}</p><p v-if="kind === 'course'">{{ selected.data.value.object.credits === null ? t('page.academic.unknownCredits') : t('page.academic.credits',{credits:n(selected.data.value.object.credits)}) }}</p></div>
        <form class="admin-form" @submit.prevent="save"><fieldset :disabled="busy || uncertain"><label>{{ t('page.academic.recordName') }}<input v-model="name" maxlength="256" required /></label><label>{{ t('page.academic.biography') }}<textarea v-model="biography" rows="7" maxlength="8000"></textarea></label><label>{{ t(kind === 'course' ? 'page.academic.college' : 'page.academic.department') }}<select v-model="department"><option value="">{{ t('page.academic.unknown') }}</option><option v-for="item in options.data.value?.departments" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><template v-if="kind === 'course'"><label>{{ t('page.academic.code') }}<input v-model="code" maxlength="128" /></label><label class="checkbox"><input v-model="unknownCredits" type="checkbox" />{{ t('page.academic.unknownCreditsToggle') }}</label><label>{{ t('page.academic.creditsLabel') }}<input v-model="credits" type="number" min="0" max="100" step="any" :disabled="unknownCredits" :required="!unknownCredits" /></label><label>{{ t('page.academic.category') }}<select v-model="category"><option value="">{{ t('page.academic.unknown') }}</option><option v-for="item in options.data.value?.categories" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><label>{{ t('page.academic.nature') }}<select v-model="nature"><option value="">{{ t('page.academic.unknown') }}</option><option v-for="item in options.data.value?.natures" :key="item.id" :value="item.id">{{ item.name }}</option></select></label></template></fieldset><p v-if="error" role="alert">{{ t(`page.academic.errors.${error}`) }}</p><p v-if="notice" role="status">{{ t(`page.academic.${notice}`) }}</p><p v-if="uncertain" role="status">{{ t('page.academic.uncertain') }}</p><div class="admin-actions"><button type="submit" :disabled="busy">{{ t(uncertain ? 'page.academic.retry' : 'page.academic.saveChanges') }}</button><button v-if="error === 'conflict'" type="button" :disabled="busy || uncertain" @click="open(selectedId,true)">{{ t('page.academic.reloadCompare') }}</button><button type="button" :disabled="busy" @click="close">{{ t('page.academic.cancel') }}</button></div></form>
      </template>
</Card>
    </div>
  </div>
</Page>
</template>
