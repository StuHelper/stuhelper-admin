<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {onBeforeRouteLeave} from 'vue-router';

import {useI18n} from '@vben/locales';

import locale7 from '../locales/langs/ar-EG/page.json';
import locale1 from '../locales/langs/en-US/page.json';
import locale5 from '../locales/langs/es-ES/page.json';
import locale4 from '../locales/langs/fr-FR/page.json';
import locale2 from '../locales/langs/ja-JP/page.json';
import locale3 from '../locales/langs/ko-KR/page.json';
import locale6 from '../locales/langs/ru-RU/page.json';
import locale0 from '../locales/langs/zh-CN/page.json';
import {AcademicError,call,Mutation,type Presentation,type PresentationView,query} from './api';
import StatusBlock from './StatusBlock.vue';
import {useLoad} from './useLoad';
const props=defineProps<{schoolId:string}>();const emit=defineEmits<{pending:[busy:boolean,dirty:boolean]}>();const {t,locale}=useI18n();
const scope=ref(props.schoolId);const editingLocale=ref(locale.value);const comparison=ref<Presentation>();const form=ref<Presentation>();const baseline=ref('');const busy=ref(false);const uncertain=ref(false);const error=ref('');const saved=ref(false);const mutation=new Mutation();
const dictionaries={'zh-CN':locale0,'en-US':locale1,'ja-JP':locale2,'ko-KR':locale3,'fr-FR':locale4,'es-ES':locale5,'ru-RU':locale6,'ar-EG':locale7};
const names=['recommendation','quality','difficulty','workload','grading'] as const;
const data=useLoad(signal=>call<PresentationView>('reviews','/admin/presentation'+query({school_id:scope.value}),'PresentationView',{signal}));
const dirty=computed(()=>!!form.value&&JSON.stringify(form.value)!==baseline.value);
async function load(preserve=false){await data.load();if(!data.data.value){if(['forbidden','unauthenticated'].includes(data.error.value))form.value=undefined;return}const value=data.data.value;if(preserve&&form.value){form.value.revision=value.configured?.revision??0;comparison.value=value.effective;return}const texts:Presentation['rating_texts']={};for(const [lang,dictionary] of Object.entries(dictionaries))texts[lang]=names.map(name=>{const rating=dictionary.academic.ratings[name];return [rating.label,rating.level1,rating.level2,rating.level3,rating.level4,rating.level5]});form.value={...value.effective,school_id:scope.value,revision:value.configured?.revision??0,rating_texts:Object.keys(value.effective.rating_texts).length > 0?value.effective.rating_texts:texts};baseline.value=JSON.stringify(form.value);comparison.value=undefined}
watch(()=>[props.schoolId,scope.value],()=>{if(scope.value!=='*')scope.value=props.schoolId;void load()},{immediate:true});watch([busy,uncertain,dirty],()=>emit('pending',busy.value||uncertain.value,dirty.value));onBeforeUnmount(()=>emit('pending',false,false));onBeforeRouteLeave(()=>!(busy.value||uncertain.value||dirty.value)||window.confirm(t('page.academic.unsavedChanges')));
async function save(){if(!form.value||busy.value)return;busy.value=true;error.value='';saved.value=false;try{await mutation.run('reviews','/admin/presentation','PresentationView',form.value,'PUT');await load();saved.value=true}catch(error_){error.value=error_ instanceof AcademicError?error_.code:'unavailable'}finally{busy.value=false;uncertain.value=mutation.uncertain}}
</script>
<template>
<section class="admin-form">
<h2>{{ t('page.academic.presentationTitle') }}</h2><label>{{ t('page.academic.policyScope') }}<select v-model="scope" :disabled="busy || uncertain || dirty"><option :value="schoolId">{{ t('page.academic.school') }}</option><option value="*">{{ t('page.academic.globalScope') }}</option></select></label><StatusBlock :busy="data.busy.value" :error="data.error.value" @retry="load" />
<section v-if="comparison" class="admin-notice"><h3>{{ t('page.academic.originalContent') }}</h3><p>{{ t('page.academic.guestPreview') }} {{ comparison.guest_preview }}</p><p>{{ t('page.academic.memberPreview') }} {{ comparison.member_preview }}</p><p>{{ t('page.academic.previewRatio') }} {{ comparison.preview_ratio }}</p><p v-for="(row,index) in comparison.rating_texts[editingLocale]" :key="index">{{ row.join(' · ') }}</p></section><form v-if="form" class="admin-form" @submit.prevent="save"><fieldset :disabled="busy || uncertain"><label>{{ t('page.academic.guestPreview') }}<input v-model.number="form.guest_preview" type="number" min="0" max="1000" required /></label><label>{{ t('page.academic.memberPreview') }}<input v-model.number="form.member_preview" type="number" min="0" max="1000" required /></label><label>{{ t('page.academic.previewRatio') }}<input v-model.number="form.preview_ratio" type="number" min="0.001" max="0.999" step="0.001" required /></label><label>{{ t('page.academic.ratingTextLanguage') }}<select v-model="editingLocale"><option v-for="lang in Object.keys(dictionaries)" :key="lang" :value="lang">{{ lang }}</option></select></label><fieldset v-for="(row,index) in form.rating_texts[editingLocale]" :key="index"><legend>{{ t(`page.academic.ratings.${names[index]}.label`) }}</legend><label v-for="(_,level) in row" :key="level">{{ level === 0 ? t('page.academic.recordName') : t(`page.academic.ratings.${names[index]}.level${level}`) }}<input v-model="row[level]" maxlength="100" required /></label></fieldset></fieldset><p v-if="error" role="alert">{{ t(`page.academic.errors.${error}`) }}</p><p v-if="saved" role="status">{{ t('page.academic.saved') }}</p><p v-if="uncertain">{{ t('page.academic.uncertain') }}</p><div class="admin-actions"><button :disabled="busy">{{ t(uncertain ? 'page.academic.retry' : 'page.academic.saveChanges') }}</button><button v-if="error === 'conflict'" type="button" :disabled="busy || uncertain" @click="load(true)">{{ t('page.academic.reloadCompare') }}</button><button type="button" :disabled="busy || uncertain" @click="load()">{{ t('page.academic.cancel') }}</button></div></form>
</section>
</template>
