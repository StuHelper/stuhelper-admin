<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { Page } from '@vben/common-ui';
import { useI18n } from '@vben/locales';

import { Alert, AutoComplete, Button, Card, Checkbox, CheckboxGroup, DatePicker, Descriptions, DescriptionsItem, Empty, Image, Input, InputNumber, Select, Space, Spin, TabPane, Tabs, Tag, Textarea } from 'ant-design-vue';

import { methods, type Schemas, verification, VerificationError } from '#/api/verification';
import { tagColor } from '#/console-ui';

const { t, d, n } = useI18n();
const schoolId = ref('');
const tab = ref<'configuration' | 'credentials' | 'jobs' | 'requests' | 'reviews' | 'suggestions'>('reviews');
const busy = ref(false); const error = ref(''); const notice = ref('');
const applications = ref<Schemas['Application'][]>([]); const jobs = ref<Schemas['Job'][]>([]); const removals = ref<Schemas['RemovalRequest'][]>([]); const schools = ref<Schemas['School'][]>([]); const suggestions = ref<Schemas['Suggestion'][]>([]);
const application = ref<Schemas['Application']>(); const form = ref<Schemas['ManualInput']>();
const pictures = ref<{ id: string; type: string; url: string; }[]>([]);
const studentProfile = ref<Schemas['StudentProfile']>();
const credential = ref<Schemas['Credential']>(); const credentialId = ref(''); const expiry = ref(''); const note = ref('');
const removalNotes = reactive<Record<string, string>>({}); const suggestionNotes = reactive<Record<string, string>>({});
const config = reactive<Schemas['School']>({ id: '', name: '', enabled: false, methods: [], notice_version: 'v1', opening_date: '', newcomer_days: 90, email_domain: '', material_types: ['student_card', 'admission_letter'], revision: 0 });
const materialTypeList = ref<string[]>(['student_card', 'admission_letter']);
const after = ref(''); const more = ref(false);
function clearPictures() { for (const picture of pictures.value) URL.revokeObjectURL(picture.url); pictures.value = []; }
async function action(fn: () => Promise<void>) { if (busy.value) return; busy.value = true; error.value = ''; notice.value = ''; try { await fn(); } catch (error_) { error.value = error_ instanceof VerificationError ? error_.code : 'network'; } finally { busy.value = false; } }
function clearSelection() { studentProfile.value = undefined; application.value = undefined; form.value = undefined; note.value = ''; expiry.value = ''; clearPictures(); }
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
      materialTypeList.value = [...config.material_types]; more.value = false;

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
    const payload: Schemas['ReviewInput'] = { decision, note: note.value.trim(), revision: application.value.revision, expires_at: decision === 'approve' && expiry.value ? new Date(`${expiry.value}Z`).toISOString() : null };
    await verification.write('Application', `/api/v1/admin/verification/applications/${application.value.id}/review`, payload);
    applications.value = applications.value.filter(a => a.id !== application.value?.id); clearSelection(); notice.value = 'saved';
  });
}
async function decideRemoval(row: Schemas['RemovalRequest'], approve: boolean) { await action(async () => { await verification.write('RemovalRequest', `/api/v1/admin/verification/requests/${row.id}/review`, { approve, note: (removalNotes[row.id] ?? '').trim(), revision: row.revision } satisfies Schemas['DecisionInput']); removals.value = removals.value.filter(r => r.id !== row.id); notice.value = 'saved'; }); }
async function saveConfig() { await action(async () => { const saved = await verification.write('School', `/api/v1/admin/verification/schools/${encodeURIComponent(config.id)}`, { ...config, material_types: materialTypeList.value.map(s => s.trim()).filter(Boolean) }, 'PUT'); Object.assign(config, saved); notice.value = 'saved'; }); }
async function lookupCredential() { await action(async () => { studentProfile.value = undefined; credential.value = undefined; note.value = ''; credential.value = await verification.get('Credential', `/api/v1/admin/verification/credentials/${encodeURIComponent(credentialId.value.trim())}`); note.value = ''; }); }
async function manageCredential(actionName: 'graduate' | 'revoke') { await action(async () => { if (!credential.value) return; credential.value = await verification.write('Credential', `/api/v1/admin/verification/credentials/${credential.value.id}/${actionName}`, { approve: true, note: note.value.trim(), revision: credential.value.revision } satisfies Schemas['DecisionInput']); notice.value = 'saved'; }); }
async function retryJob(job: Schemas['Job']) { await action(async () => { const updated = await verification.write('Job', `/api/v1/admin/verification/jobs/${encodeURIComponent(job.id)}/retry`); jobs.value = jobs.value.map(j => j.id === updated.id ? updated : j); notice.value = 'saved'; }); }
async function decideSuggestion(row: Schemas['Suggestion'], approve: boolean) { await action(async () => { const saved = await verification.write('Suggestion', `/api/v1/admin/verification/suggestions/${row.id}/review`, { approve, note: (suggestionNotes[row.id] ?? '').trim(), revision: row.revision } satisfies Schemas['DecisionInput']); suggestions.value = suggestions.value.map(s => s.id === saved.id ? saved : s); notice.value = 'saved'; }); }
async function showProfile(mode: 'basic' | 'document' | 'full' | 'raw' = 'basic') {
  await action(async () => { if (!credential.value) return; studentProfile.value = undefined; studentProfile.value = await verification.get('StudentProfile', `/api/v1/admin/verification/credentials/${credential.value.id}/profile?full=${mode === 'full' || mode === 'raw'}&document=${mode === 'document' || mode === 'raw'}&raw=${mode === 'raw'}`); });
}
function profileValue(value: unknown, field: number | string) {
  if (value === null) return t('page.verification.notProvided')
  if (field === 'identity_valid_until' && typeof value === 'string' && Number.isFinite(Date.parse(value))) return d(new Date(value), 'dateTime')
  return typeof value === 'string' ? value : JSON.stringify(value)
}
watch(schoolId, (value) => { if (value !== value.trim()) { schoolId.value = value.trim(); return; } after.value = ''; more.value = false; applications.value = []; jobs.value = []; removals.value = []; clearSelection(); });
watch(credentialId, () => { credential.value = undefined; studentProfile.value = undefined; note.value = ''; });
onMounted(async () => { await action(async () => { schools.value = await verification.list('School', '/api/v1/verification/schools?limit=100'); schoolId.value = schools.value[0]?.id ?? ''; }); if (schoolId.value) await load(); });
onBeforeUnmount(clearPictures);
</script>

<template>
  <Page :title="t('page.verification.adminTitle')" :description="t('page.verification.adminDescription')">
    <div class="verification-admin">
      <Alert v-if="error" type="error" show-icon :message="t(`page.verification.errors.${error}`)" />
      <Alert v-if="notice" type="success" show-icon :message="t(`page.verification.${notice}`)" />
      <Card :bordered="false">
        <form class="admin-toolbar" @submit.prevent="load()">
          <label class="verification-school">{{ t('page.verification.schoolId') }}
            <AutoComplete v-model:value="schoolId" :maxlength="64" :disabled="busy" :options="schools.map(s => ({ value: s.id, label: `${s.id} · ${s.name}` }))" />
          </label>
          <Button type="primary" html-type="submit" :loading="busy">{{ t('page.verification.load') }}</Button>
        </form>
        <Tabs class="mt-2" :active-key="tab" @change="changeTab($event as typeof tab)">
          <TabPane key="reviews" :tab="t('page.verification.reviewQueue')" :disabled="busy && tab !== 'reviews'" />
          <TabPane key="requests" :tab="t('page.verification.requests')" :disabled="busy && tab !== 'requests'" />
          <TabPane key="configuration" :tab="t('page.verification.configuration')" :disabled="busy && tab !== 'configuration'" />
          <TabPane key="credentials" :tab="t('page.verification.credentialManagement')" :disabled="busy && tab !== 'credentials'" />
          <TabPane key="jobs" :tab="t('page.verification.jobs')" :disabled="busy && tab !== 'jobs'" />
          <TabPane key="suggestions" :tab="t('page.verification.suggestions')" :disabled="busy && tab !== 'suggestions'" />
        </Tabs>
      </Card>

      <section v-if="tab === 'reviews'" class="admin-grid">
        <Card :bordered="false" :title="t('page.verification.reviewQueue')" class="admin-panel">
          <Spin v-if="busy && applications.length === 0" />
          <Empty v-else-if="applications.length === 0" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.verification.empty')" />
          <article v-for="a in applications" :key="a.id" :class="{ 'is-selected': application?.id === a.id }">
            <strong>{{ t(`page.verification.stages.${a.stage}`) }} {{ t(`page.verification.kinds.${a.kind}`) }}</strong>
            <p class="meta">{{ d(new Date(a.created_at), 'dateTime') }}</p>
            <Button type="link" size="small" :disabled="busy" @click="openReview(a)">{{ t('page.verification.review') }}</Button>
          </article>
        </Card>
        <Empty v-if="!application || !form" class="console-placeholder" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.console.selectItem')" />
        <Card v-else :bordered="false" :title="t('page.verification.review')" class="admin-panel console-detail">
          <Descriptions :column="1" size="small" bordered>
            <DescriptionsItem :label="t('page.verification.studentId')">{{ form.student_id }}</DescriptionsItem>
            <DescriptionsItem :label="t('page.verification.name')">{{ form.name }}</DescriptionsItem>
            <DescriptionsItem :label="t('page.verification.department')">{{ form.department }}</DescriptionsItem>
            <DescriptionsItem :label="t('page.verification.contactEmail')">{{ form.email }}</DescriptionsItem>
            <DescriptionsItem :label="t('page.verification.materialType')">{{ t(`page.verification.materialTypes.${form.material_type}`, form.material_type) }}</DescriptionsItem>
          </Descriptions>
          <div class="admin-pictures">
            <template v-for="picture in pictures" :key="picture.id">
              <a v-if="picture.type === 'application/pdf'" :href="picture.url" download>{{ t('page.verification.legacyMaterial') }}</a>
              <Image v-else :src="picture.url" :alt="t('page.verification.photoPreview')" />
            </template>
          </div>
          <form class="admin-form" @submit.prevent="review('approve')">
            <label class="admin-wide">{{ t('page.verification.note') }}<Textarea v-model:value="note" :maxlength="500" :rows="3" required :disabled="busy" /></label>
            <label v-if="application.kind === 'newcomer'" class="admin-wide">{{ t('page.verification.expiryOverride') }}<DatePicker v-model:value="expiry" show-time value-format="YYYY-MM-DDTHH:mm" :disabled="busy" /></label>
            <Space class="admin-wide" wrap>
              <Button type="primary" html-type="submit" :disabled="busy || !note.trim()">{{ t('page.verification.approve') }}</Button>
              <Button :disabled="busy || !note.trim()" @click="review('supplement')">{{ t('page.verification.supplement') }}</Button>
              <Button danger :disabled="busy || !note.trim()" @click="review('reject')">{{ t('page.verification.reject') }}</Button>
            </Space>
          </form>
        </Card>
      </section>

      <Card v-if="tab === 'requests'" :bordered="false" :title="t('page.verification.requests')" class="admin-panel">
        <Empty v-if="removals.length === 0 && !busy" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.verification.empty')" />
        <article v-for="r in removals" :key="r.id">
          <h3>{{ t(r.kind === 'delete' ? 'page.verification.requestDelete' : 'page.verification.requestRevoke') }}</h3>
          <p>{{ r.reason }}</p>
          <p class="meta">{{ t('page.verification.credentialId') }} {{ r.credential_id }}</p>
          <label>{{ t('page.verification.note') }}<Textarea v-model:value="removalNotes[r.id]" :maxlength="500" :rows="2" :disabled="busy" /></label>
          <Space class="mt-2" wrap>
            <Button type="primary" :disabled="busy || !removalNotes[r.id]?.trim()" @click="decideRemoval(r, true)">{{ t('page.verification.approve') }}</Button>
            <Button danger :disabled="busy || !removalNotes[r.id]?.trim()" @click="decideRemoval(r, false)">{{ t('page.verification.reject') }}</Button>
          </Space>
        </article>
      </Card>

      <Card v-if="tab === 'configuration'" :bordered="false" :title="t('page.verification.configuration')" class="admin-panel">
        <form class="admin-form" @submit.prevent="saveConfig">
          <label>{{ t('page.verification.schoolId') }}<Input v-model:value="config.id" readonly required /></label>
          <label>{{ t('page.verification.schoolName') }}<Input v-model:value="config.name" :maxlength="100" required :disabled="busy" /></label>
          <Checkbox v-model:checked="config.enabled" :disabled="busy">{{ t('page.verification.enabled') }}</Checkbox>
          <label>{{ t('page.verification.noticeVersion') }}<Input v-model:value="config.notice_version" :maxlength="64" required :disabled="busy" /></label>
          <fieldset class="admin-wide">
            <legend>{{ t('page.verification.method') }}</legend>
            <CheckboxGroup v-model:value="config.methods" :disabled="busy" :options="methods.map(m => ({ value: m, label: t(`page.verification.methods.${m}`) }))" />
          </fieldset>
          <label>{{ t('page.verification.openingDate') }}<DatePicker v-model:value="config.opening_date" value-format="YYYY-MM-DD" :disabled="busy" /></label>
          <label>{{ t('page.verification.newcomerDays') }}<InputNumber v-model:value="config.newcomer_days" :min="1" :max="366" class="w-full" :disabled="busy" /></label>
          <label>{{ t('page.verification.emailDomain') }}<Input v-model:value="config.email_domain" :maxlength="253" :disabled="busy" /></label>
          <label>{{ t('page.verification.materialTypesLabel') }}<Select v-model:value="materialTypeList" mode="tags" :disabled="busy" :token-separators="[',']" /></label>
          <Space class="admin-wide" align="center">
            <Button type="primary" html-type="submit" :loading="busy" :disabled="!config.id || !config.name.trim() || !config.notice_version.trim() || !config.newcomer_days || materialTypeList.length === 0">{{ t('page.verification.save') }}</Button>
            <span class="meta">{{ t('page.verification.revision') }} {{ n(config.revision) }}</span>
          </Space>
        </form>
      </Card>

      <Card v-if="tab === 'credentials'" :bordered="false" :title="t('page.verification.credentialManagement')" class="admin-panel">
        <form class="admin-toolbar" @submit.prevent="lookupCredential">
          <label>{{ t('page.verification.credentialId') }}<Input v-model:value="credentialId" :disabled="busy" required /></label>
          <Button type="primary" html-type="submit" :loading="busy" :disabled="!credentialId.trim()">{{ t('page.verification.load') }}</Button>
        </form>
        <div v-if="credential" class="mt-4">
          <Descriptions :column="{ xs: 1, md: 4 }" size="small">
            <DescriptionsItem :label="t('page.verification.schoolId')">{{ credential.school_id }}</DescriptionsItem>
            <DescriptionsItem :label="t('page.verification.name')">{{ credential.student_display }}</DescriptionsItem>
            <DescriptionsItem><Tag>{{ t(`page.verification.kinds.${credential.kind}`) }}</Tag></DescriptionsItem>
            <DescriptionsItem><Tag :color="tagColor(credential.state)">{{ t(`page.verification.states.${credential.state}`) }}</Tag></DescriptionsItem>
          </Descriptions>
          <Space wrap>
            <Button :disabled="busy" @click="showProfile()">{{ t('page.verification.viewProfile') }}</Button>
            <Button :disabled="busy" @click="showProfile('full')">{{ t('page.verification.fullProfile') }}</Button>
            <Button :disabled="busy" @click="showProfile('document')">{{ t('page.verification.documentProfile') }}</Button>
            <Button :disabled="busy" @click="showProfile('raw')">{{ t('page.verification.rawProfile') }}</Button>
          </Space>
          <section v-if="studentProfile" class="mt-4">
            <h3>{{ t('page.verification.profileTitle') }}</h3>
            <p><Tag>{{ t(`page.verification.profileStatus.${studentProfile.data_status}`) }}</Tag><span v-if="studentProfile.collected_at" class="meta">{{ t('page.verification.collectedAt') }} {{ d(new Date(studentProfile.collected_at), 'dateTime') }}</span></p>
            <Descriptions :column="1" size="small" bordered>
              <DescriptionsItem v-for="(value, field) in studentProfile.fields" :key="field">
                <template #label>{{ t(`page.verification.profileFields.${field}`) }}<small v-if="studentProfile.field_sources[field]" class="block opacity-70">{{ t(`page.verification.profileSources.${studentProfile.field_sources[field]}`) }}</small></template>
                {{ profileValue(value, field) }}
              </DescriptionsItem>
            </Descriptions>
            <pre v-if="studentProfile.raw_data">{{ studentProfile.raw_data }}</pre>
          </section>
          <label class="mt-4">{{ t('page.verification.note') }}<Textarea v-model:value="note" :maxlength="500" :rows="2" :disabled="busy" /></label>
          <Space class="mt-2" wrap>
            <Button danger :disabled="busy || !note.trim() || credential.state !== 'active'" @click="manageCredential('revoke')">{{ t('page.verification.revoke') }}</Button>
            <Button :disabled="busy || !note.trim() || credential.state !== 'active' || credential.kind !== 'student'" @click="manageCredential('graduate')">{{ t('page.verification.graduate') }}</Button>
          </Space>
        </div>
      </Card>

      <Card v-if="tab === 'jobs'" :bordered="false" :title="t('page.verification.jobs')" class="admin-panel">
        <Empty v-if="jobs.length === 0 && !busy" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.verification.empty')" />
        <article v-for="job in jobs" :key="job.id">
          <div class="console-row-head"><strong>{{ t(job.kind === 'mail' ? 'page.verification.mailJob' : 'page.verification.eventJob') }}</strong><Tag :color="tagColor(job.state)">{{ t(`page.verification.states.${job.state}`) }}</Tag></div>
          <p class="meta">{{ n(job.attempts) }}</p>
          <p v-if="job.code">{{ t(`page.verification.errors.${job.code}`, job.code) }}</p>
          <Button v-if="job.state === 'manual'" size="small" :disabled="busy" @click="retryJob(job)">{{ t('page.verification.retryJob') }}</Button>
        </article>
      </Card>

      <Card v-if="tab === 'suggestions'" :bordered="false" :title="t('page.verification.suggestions')" class="admin-panel">
        <Empty v-if="suggestions.length === 0 && !busy" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('page.verification.empty')" />
        <article v-for="s in suggestions" :key="s.id">
          <div class="console-row-head"><strong>{{ s.name }}</strong><Tag :color="tagColor(s.state)">{{ t(`page.verification.states.${s.state}`) }}</Tag></div>
          <p class="meta">{{ s.website }}</p>
          <template v-if="s.state === 'pending'">
            <label>{{ t('page.verification.note') }}<Textarea v-model:value="suggestionNotes[s.id]" :maxlength="500" :rows="2" :disabled="busy" /></label>
            <Space class="mt-2" wrap>
              <Button type="primary" :disabled="busy || !suggestionNotes[s.id]?.trim()" @click="decideSuggestion(s, true)">{{ t('page.verification.approve') }}</Button>
              <Button danger :disabled="busy || !suggestionNotes[s.id]?.trim()" @click="decideSuggestion(s, false)">{{ t('page.verification.reject') }}</Button>
            </Space>
          </template>
          <p v-else>{{ s.note }}</p>
        </article>
      </Card>
      <Button v-if="more" class="load-more" :loading="busy" @click="load(true)">{{ t('page.verification.loadMore') }}</Button>
    </div>
  </Page>
</template>

<style scoped>
.admin-toolbar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: end; }
.admin-toolbar label { flex: 1; max-width: 25rem; }
.admin-grid { display: grid; grid-template-columns: minmax(16rem, 1fr) minmax(20rem, 2fr); gap: 1rem; align-items: start; }
.admin-panel h3 { font-weight: 600; }
.admin-panel article { padding: .75rem; margin-block-end: .5rem; border: 1px solid hsl(var(--border)); border-radius: 6px; }
.admin-panel p { margin-block: .35rem; }
.admin-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; align-items: end; }
.admin-wide { grid-column: 1 / -1; }
.admin-form fieldset { display: grid; gap: .5rem; }
.admin-pictures { display: grid; gap: .6rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); margin-block: 1rem; }
.admin-panel pre { overflow-wrap: anywhere; white-space: pre-wrap; max-width: 100%; }
.load-more { justify-self: start; }
@media(max-width: 900px) { .admin-grid { grid-template-columns: 1fr; } }
@media(max-width: 600px) { .admin-form { grid-template-columns: 1fr; } .admin-toolbar label { max-width: none; min-width: 100%; } }
</style>
