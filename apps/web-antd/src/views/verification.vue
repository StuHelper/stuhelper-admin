<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { methods, type Schemas, verification, VerificationError } from '#/api/verification';

const { t, d, n } = useI18n();
const schoolId = ref('');
const tab = ref<'configuration' | 'credentials' | 'jobs' | 'requests' | 'reviews' | 'suggestions'>('reviews');
const busy = ref(false); const error = ref(''); const notice = ref('');
const applications = ref<Schemas['Application'][]>([]); const jobs = ref<Schemas['Job'][]>([]); const removals = ref<Schemas['RemovalRequest'][]>([]); const schools = ref<Schemas['School'][]>([]); const suggestions = ref<Schemas['Suggestion'][]>([]);
const application = ref<Schemas['Application']>(); const form = ref<Schemas['ManualInput']>();
const pictures = ref<{ id: string; type: string; url: string; }[]>([]);
const credential = ref<Schemas['Credential']>(); const credentialId = ref(''); const expiry = ref(''); const note = ref('');
const removalNotes = reactive<Record<string, string>>({}); const suggestionNotes = reactive<Record<string, string>>({});
const config = reactive<Schemas['School']>({ id: '', name: '', enabled: false, methods: [], notice_version: 'v1', opening_date: '', newcomer_days: 90, email_domain: '', material_types: ['student_card', 'admission_letter'], revision: 0 });
const materialTypes = ref('student_card,admission_letter');
const after = ref(''); const more = ref(false);
function clearPictures() { for (const picture of pictures.value) URL.revokeObjectURL(picture.url); pictures.value = []; }
async function action(fn: () => Promise<void>) { if (busy.value) return; busy.value = true; error.value = ''; notice.value = ''; try { await fn(); } catch (error_) { error.value = error_ instanceof VerificationError ? error_.code : 'network'; } finally { busy.value = false; } }
function clearSelection() { application.value = undefined; form.value = undefined; note.value = ''; expiry.value = ''; clearPictures(); }
async function load(append = false) {
  await action(async () => {
    clearSelection();
    const cursor = append ? after.value : '';
    const query = `?limit=25&after=${encodeURIComponent(cursor)}`;
    switch (tab.value) {
    case 'configuration': {
      if (!schoolId.value) throw new VerificationError('invalid_input');
      try { Object.assign(config, await verification.get('School', `/api/v1/admin/verification/schools/${encodeURIComponent(schoolId.value)}`)); }
      catch (error_) { if (!(error_ instanceof VerificationError && error_.code === 'not_found')) throw error_; Object.assign(config, { id: schoolId.value, name: '', enabled: false, methods: [], notice_version: 'v1', opening_date: '', newcomer_days: 90, email_domain: '', material_types: ['student_card', 'admission_letter'], revision: 0 }); }
      materialTypes.value = config.material_types.join(','); more.value = false;

    break;
    }
    case 'jobs': { const rows = await verification.list('Job', `/api/v1/admin/verification/jobs${query}&school_id=${encodeURIComponent(schoolId.value)}`); jobs.value = append ? [...jobs.value, ...rows] : rows; more.value = rows.length === 25; after.value = rows.at(-1)?.id ?? '';
    break;
    }
    case 'requests':
    case 'reviews': {
      if (!schoolId.value) throw new VerificationError('invalid_input');
      if (tab.value === 'reviews') { const rows = await verification.list('Application', `/api/v1/admin/verification/schools/${encodeURIComponent(schoolId.value)}/applications${query}`); applications.value = append ? [...applications.value, ...rows] : rows; more.value = rows.length === 25; after.value = rows.at(-1)?.id ?? ''; }
      else { const rows = await verification.list('RemovalRequest', `/api/v1/admin/verification/schools/${encodeURIComponent(schoolId.value)}/requests${query}`); removals.value = append ? [...removals.value, ...rows] : rows; more.value = rows.length === 25; after.value = rows.at(-1)?.id ?? ''; }

    break;
    }
    case 'suggestions': { const rows = await verification.list('Suggestion', `/api/v1/admin/verification/suggestions${query}`); suggestions.value = append ? [...suggestions.value, ...rows] : rows; more.value = rows.length === 25; after.value = rows.at(-1)?.id ?? '';
    break;
    }
    default: { more.value = false;
    }
    }
  });
}
async function changeTab(value: typeof tab.value) { tab.value = value; after.value = ''; more.value = false; await load(); }
async function openReview(row: Schemas['Application']) {
  await action(async () => {
    clearSelection();
    const result = await verification.get('ManualInput', `/api/v1/admin/verification/applications/${row.id}/form`);
    const materials = await verification.list('Material', `/api/v1/verification/applications/${row.id}/materials`);
    const images: typeof pictures.value = [];
    try { for (const material of materials) { const blob = await verification.material(material.id); images.push({ id: material.id, url: URL.createObjectURL(blob), type: blob.type }); } }
    catch (error_) { for (const image of images) URL.revokeObjectURL(image.url); throw error_; }
    application.value = row; form.value = result; pictures.value = images;
  });
}
async function review(decision: Schemas['ReviewInput']['decision']) {
  await action(async () => {
    if (!application.value) return;
    const payload: Schemas['ReviewInput'] = { decision, note: note.value, revision: application.value.revision, expires_at: decision === 'approve' && expiry.value ? new Date(`${expiry.value}Z`).toISOString() : null };
    await verification.write('Application', `/api/v1/admin/verification/applications/${application.value.id}/review`, payload);
    applications.value = applications.value.filter(a => a.id !== application.value?.id); clearSelection(); notice.value = 'saved';
  });
}
async function decideRemoval(row: Schemas['RemovalRequest'], approve: boolean) { await action(async () => { await verification.write('RemovalRequest', `/api/v1/admin/verification/requests/${row.id}/review`, { approve, note: removalNotes[row.id] ?? '', revision: row.revision } satisfies Schemas['DecisionInput']); removals.value = removals.value.filter(r => r.id !== row.id); notice.value = 'saved'; }); }
async function saveConfig() { await action(async () => { const saved = await verification.write('School', `/api/v1/admin/verification/schools/${encodeURIComponent(config.id)}`, { ...config, material_types: materialTypes.value.split(',').map(s => s.trim()).filter(Boolean) }, 'PUT'); Object.assign(config, saved); notice.value = 'saved'; }); }
async function lookupCredential() { await action(async () => { credential.value = await verification.get('Credential', `/api/v1/admin/verification/credentials/${encodeURIComponent(credentialId.value)}`); note.value = ''; }); }
async function manageCredential(actionName: 'graduate' | 'revoke') { await action(async () => { if (!credential.value) return; credential.value = await verification.write('Credential', `/api/v1/admin/verification/credentials/${credential.value.id}/${actionName}`, { approve: true, note: note.value, revision: credential.value.revision } satisfies Schemas['DecisionInput']); notice.value = 'saved'; }); }
async function retryJob(job: Schemas['Job']) { await action(async () => { const updated = await verification.write('Job', `/api/v1/admin/verification/jobs/${encodeURIComponent(job.id)}/retry`); jobs.value = jobs.value.map(j => j.id === updated.id ? updated : j); notice.value = 'saved'; }); }
async function decideSuggestion(row: Schemas['Suggestion'], approve: boolean) { await action(async () => { const saved = await verification.write('Suggestion', `/api/v1/admin/verification/suggestions/${row.id}/review`, { approve, note: suggestionNotes[row.id] ?? '', revision: row.revision } satisfies Schemas['DecisionInput']); suggestions.value = suggestions.value.map(s => s.id === saved.id ? saved : s); notice.value = 'saved'; }); }
onMounted(async () => { await action(async () => { schools.value = await verification.list('School', '/api/v1/verification/schools?limit=100'); schoolId.value = schools.value[0]?.id ?? ''; }); if (schoolId.value) await load(); });
onBeforeUnmount(clearPictures);
</script>

<template>
  <Page :title="t('page.verification.adminTitle')" :description="t('page.verification.adminDescription')">
    <div class="verification-admin">
      <p v-if="error" class="admin-message error" role="alert">{{ t(`page.verification.errors.${error}`) }}</p>
      <p v-if="notice" class="admin-message" role="status">{{ t(`page.verification.${notice}`) }}</p>
      <p v-if="busy" role="status">{{ t('page.verification.loading') }}</p>
      <form class="admin-toolbar" @submit.prevent="load()"><label>{{ t('page.verification.schoolId') }}<input v-model.trim="schoolId" list="verification-schools" maxlength="64" :disabled="busy" /><datalist id="verification-schools"><option v-for="s in schools" :key="s.id" :value="s.id">{{ s.name }}</option></datalist></label><button :disabled="busy">{{ t('page.verification.load') }}</button></form>
      <nav class="admin-tabs" :aria-label="t('page.verification.adminTitle')">
        <button :aria-pressed="tab === 'reviews'" :disabled="busy" @click="changeTab('reviews')">{{ t('page.verification.reviewQueue') }}</button>
        <button :aria-pressed="tab === 'requests'" :disabled="busy" @click="changeTab('requests')">{{ t('page.verification.requests') }}</button>
        <button :aria-pressed="tab === 'configuration'" :disabled="busy" @click="changeTab('configuration')">{{ t('page.verification.configuration') }}</button>
        <button :aria-pressed="tab === 'credentials'" :disabled="busy" @click="changeTab('credentials')">{{ t('page.verification.credentialManagement') }}</button>
        <button :aria-pressed="tab === 'jobs'" :disabled="busy" @click="changeTab('jobs')">{{ t('page.verification.jobs') }}</button>
        <button :aria-pressed="tab === 'suggestions'" :disabled="busy" @click="changeTab('suggestions')">{{ t('page.verification.suggestions') }}</button>
      </nav>
      <section v-if="tab === 'reviews'" class="admin-grid">
        <div class="admin-panel"><h2>{{ t('page.verification.reviewQueue') }}</h2><p v-if="applications.length === 0 && !busy">{{ t('page.verification.empty') }}</p><article v-for="a in applications" :key="a.id"><strong>{{ t(`page.verification.stages.${a.stage}`) }} {{ t(`page.verification.kinds.${a.kind}`) }}</strong><p>{{ d(new Date(a.created_at), 'dateTime') }}</p><button :disabled="busy" @click="openReview(a)">{{ t('page.verification.review') }}</button></article></div>
        <div v-if="application && form" class="admin-panel"><h2>{{ t('page.verification.review') }}</h2><dl><dt>{{ t('page.verification.studentId') }}</dt><dd>{{ form.student_id }}</dd><dt>{{ t('page.verification.name') }}</dt><dd>{{ form.name }}</dd><dt>{{ t('page.verification.department') }}</dt><dd>{{ form.department }}</dd><dt>{{ t('page.verification.contactEmail') }}</dt><dd>{{ form.email }}</dd><dt>{{ t('page.verification.materialType') }}</dt><dd>{{ t(`page.verification.materialTypes.${form.material_type}`, form.material_type) }}</dd></dl><div class="admin-pictures"><template v-for="picture in pictures" :key="picture.id"><a v-if="picture.type === 'application/pdf'" :href="picture.url" download>{{ t('page.verification.legacyMaterial') }}</a><img v-else :src="picture.url" :alt="t('page.verification.photoPreview')" /></template></div><form @submit.prevent="review('approve')"><label>{{ t('page.verification.note') }}<textarea v-model.trim="note" maxlength="500" required></textarea></label><label v-if="application.kind === 'newcomer'">{{ t('page.verification.expiryOverride') }}<input v-model="expiry" type="datetime-local" /></label><div class="admin-actions"><button :disabled="busy || !note">{{ t('page.verification.approve') }}</button><button type="button" :disabled="busy || !note" @click="review('supplement')">{{ t('page.verification.supplement') }}</button><button type="button" :disabled="busy || !note" @click="review('reject')">{{ t('page.verification.reject') }}</button></div></form></div>
      </section>
      <section v-if="tab === 'requests'" class="admin-panel"><h2>{{ t('page.verification.requests') }}</h2><p v-if="removals.length === 0 && !busy">{{ t('page.verification.empty') }}</p><article v-for="r in removals" :key="r.id"><h3>{{ t(r.kind === 'delete' ? 'page.verification.requestDelete' : 'page.verification.requestRevoke') }}</h3><p>{{ r.reason }}</p><p>{{ t('page.verification.credentialId') }} {{ r.credential_id }}</p><label>{{ t('page.verification.note') }}<textarea v-model.trim="removalNotes[r.id]" maxlength="500"></textarea></label><div class="admin-actions"><button :disabled="busy || !removalNotes[r.id]" @click="decideRemoval(r, true)">{{ t('page.verification.approve') }}</button><button :disabled="busy || !removalNotes[r.id]" @click="decideRemoval(r, false)">{{ t('page.verification.reject') }}</button></div></article></section>
      <section v-if="tab === 'configuration'" class="admin-panel"><h2>{{ t('page.verification.configuration') }}</h2><form class="admin-form" @submit.prevent="saveConfig"><label>{{ t('page.verification.schoolId') }}<input v-model="config.id" readonly required /></label><label>{{ t('page.verification.schoolName') }}<input v-model.trim="config.name" maxlength="100" required /></label><label class="admin-checkbox"><input v-model="config.enabled" type="checkbox" />{{ t('page.verification.enabled') }}</label><label>{{ t('page.verification.noticeVersion') }}<input v-model.trim="config.notice_version" maxlength="64" required /></label><fieldset class="admin-wide"><legend>{{ t('page.verification.method') }}</legend><label v-for="m in methods" :key="m" class="admin-checkbox"><input v-model="config.methods" type="checkbox" :value="m" />{{ t(`page.verification.methods.${m}`) }}</label></fieldset><label>{{ t('page.verification.openingDate') }}<input v-model="config.opening_date" type="date" /></label><label>{{ t('page.verification.newcomerDays') }}<input v-model.number="config.newcomer_days" type="number" min="1" max="366" required /></label><label>{{ t('page.verification.emailDomain') }}<input v-model.trim="config.email_domain" maxlength="253" /></label><label>{{ t('page.verification.materialTypesLabel') }}<input v-model="materialTypes" required /></label><p>{{ t('page.verification.revision') }} {{ n(config.revision) }}</p><div class="admin-wide"><button :disabled="busy || !config.id">{{ t('page.verification.save') }}</button></div></form></section>
      <section v-if="tab === 'credentials'" class="admin-panel"><h2>{{ t('page.verification.credentialManagement') }}</h2><form class="admin-toolbar" @submit.prevent="lookupCredential"><label>{{ t('page.verification.credentialId') }}<input v-model.trim="credentialId" required /></label><button :disabled="busy">{{ t('page.verification.load') }}</button></form><div v-if="credential"><p>{{ credential.school_id }} {{ credential.student_display }} {{ t(`page.verification.kinds.${credential.kind}`) }} {{ t(`page.verification.states.${credential.state}`) }}</p><label>{{ t('page.verification.note') }}<textarea v-model.trim="note" maxlength="500"></textarea></label><div class="admin-actions"><button :disabled="busy || !note || credential.state !== 'active'" @click="manageCredential('revoke')">{{ t('page.verification.revoke') }}</button><button :disabled="busy || !note || credential.state !== 'active' || credential.kind !== 'student'" @click="manageCredential('graduate')">{{ t('page.verification.graduate') }}</button></div></div></section>
      <section v-if="tab === 'jobs'" class="admin-panel"><h2>{{ t('page.verification.jobs') }}</h2><p v-if="jobs.length === 0 && !busy">{{ t('page.verification.empty') }}</p><article v-for="job in jobs" :key="job.id"><strong>{{ t(job.kind === 'mail' ? 'page.verification.mailJob' : 'page.verification.eventJob') }}</strong><p>{{ t(`page.verification.states.${job.state}`) }} {{ n(job.attempts) }}</p><p v-if="job.code">{{ t(`page.verification.errors.${job.code}`, job.code) }}</p><button v-if="job.state === 'manual'" :disabled="busy" @click="retryJob(job)">{{ t('page.verification.retryJob') }}</button></article></section>
      <section v-if="tab === 'suggestions'" class="admin-panel"><h2>{{ t('page.verification.suggestions') }}</h2><p v-if="suggestions.length === 0 && !busy">{{ t('page.verification.empty') }}</p><article v-for="s in suggestions" :key="s.id"><strong>{{ s.name }}</strong><p>{{ s.website }}</p><p>{{ t(`page.verification.states.${s.state}`) }}</p><template v-if="s.state === 'pending'"><label>{{ t('page.verification.note') }}<textarea v-model.trim="suggestionNotes[s.id]" maxlength="500"></textarea></label><div class="admin-actions"><button :disabled="busy || !suggestionNotes[s.id]" @click="decideSuggestion(s, true)">{{ t('page.verification.approve') }}</button><button :disabled="busy || !suggestionNotes[s.id]" @click="decideSuggestion(s, false)">{{ t('page.verification.reject') }}</button></div></template><p v-else>{{ s.note }}</p></article></section>
      <button v-if="more" class="load-more" :disabled="busy" @click="load(true)">{{ t('page.verification.loadMore') }}</button>
    </div>
  </Page>
</template>

<style scoped>
.verification-admin { color: hsl(var(--foreground)); }
.verification-admin button { padding: .6rem .9rem; border: 1px solid hsl(var(--border)); border-radius: .35rem; background: hsl(var(--background)); cursor: pointer; min-height: 42px; }
.verification-admin button:disabled { opacity: .5; cursor: not-allowed; }
.verification-admin button:focus-visible, .verification-admin input:focus-visible, .verification-admin textarea:focus-visible { outline: 3px solid hsl(var(--primary)); outline-offset: 2px; }
.admin-toolbar, .admin-actions, .admin-tabs { display: flex; flex-wrap: wrap; gap: .65rem; align-items: end; margin-block: .8rem; }
.admin-toolbar label { flex: 1; max-width: 25rem; }
.admin-tabs button[aria-pressed=true] { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
.admin-grid { display: grid; grid-template-columns: minmax(16rem, 1fr) minmax(20rem, 2fr); gap: 1rem; align-items: start; }
.admin-panel { padding: 1.25rem; border: 1px solid hsl(var(--border)); border-radius: .6rem; background: hsl(var(--card)); }
.admin-panel h2 { font-size: 1.1rem; margin-block-end: 1rem; font-weight: 600; }
.admin-panel article { padding-block: 1rem; border-top: 1px solid hsl(var(--border)); }
.admin-panel p { margin-block: .5rem; overflow-wrap: anywhere; }
.verification-admin label { display: flex; flex-direction: column; gap: .4rem; }
.verification-admin input:not([type=checkbox]), .verification-admin textarea { border: 1px solid hsl(var(--border)); background: hsl(var(--background)); padding: .65rem; width: 100%; border-radius: .3rem; min-height: 42px; }
.verification-admin textarea { min-height: 5rem; resize: vertical; }
.admin-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.admin-wide { grid-column: 1 / -1; }
.verification-admin .admin-checkbox { flex-direction: row; align-items: center; gap: .6rem; padding-block: .4rem; }
.admin-pictures { display: grid; gap: .6rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); margin-block: 1rem; }
.admin-pictures img { width: 100%; max-height: 20rem; object-fit: contain; }
.admin-panel dl { display: grid; grid-template-columns: minmax(6rem, 1fr) 2fr; gap: .6rem; }
.admin-panel dd { overflow-wrap: anywhere; }
.admin-message { border-inline-start: 4px solid hsl(var(--primary)); padding: 1rem; background: hsl(var(--card)); margin-block-end: 1rem; }
.admin-message.error { border-inline-start-color: #b74b34; }
.load-more { margin-block-start: 1rem; }
@media(max-width: 900px) { .admin-grid { grid-template-columns: 1fr; } }
@media(max-width: 600px) { .admin-form { grid-template-columns: 1fr; } .admin-toolbar label { max-width: none; min-width: 100%; } }
</style>
