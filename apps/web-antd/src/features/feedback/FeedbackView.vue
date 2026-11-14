<script setup lang="ts">
import type { components } from '#/api/moderation.gen';

import { computed, onMounted, ref } from 'vue';

import { useI18n } from '@vben/locales';

import { errorCode, isUncertain } from '#/shared/api/errors';
import { schemaOf } from '#/shared/api/schema';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import { useHttp } from '#/shared/session';
import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';

import contract from '../../../../../contracts/moderation.openapi.json';

type Feedback = components['schemas']['Feedback'];
const { t } = useI18n();
const http = useHttp();
const contactAddress = 'feedback@stuhelper.com';
const format = useFormat();
const errorText = useErrorText();
const parsePage = schemaOf<components['schemas']['FeedbackPage']>(contract.components.schemas, 'FeedbackPage');
const parseMessage = schemaOf<Feedback>(contract.components.schemas, 'Feedback');
const parseReply = schemaOf<components['schemas']['FeedbackReply']>(contract.components.schemas, 'FeedbackReply');
const items = ref<Feedback[]>([]);
const selected = ref<Feedback>();
const state = ref<Feedback['state']>('new');
const filter = ref('');
const note = ref('');
const body = ref('');
const next = ref('');
const busy = ref(false);
const error = ref('');
const success = ref('');
const pendingReply = ref<{ body: string; id: string; key: string }>();
const pendingUpdate = ref<{ body: components['schemas']['FeedbackUpdate']; id: string; key: string }>();
const states: Feedback['state'][] = ['new', 'processing', 'resolved', 'spam'];
// A details refresh must not silently upgrade the revision of an existing draft.
const editBase = ref({ revision: 0, state: 'new', note: '' });
const editDirty = computed(() => !!selected.value && (state.value !== editBase.value.state || note.value !== editBase.value.note));
const dirty = computed(() => editDirty.value || !!body.value);
useLeaveGuard(() => pendingReply.value || pendingUpdate.value ? t('page.common.leaveUncertain') : (dirty.value ? t('page.common.leaveUnsaved') : ''));
function adopt(message: Feedback) {
  selected.value = message;
  state.value = message.state;
  note.value = message.note;
  editBase.value = { revision: message.revision, state: message.state, note: message.note };
}

function failed(cause: unknown) {
  error.value = errorCode(cause);
  if (['forbidden', 'unauthenticated'].includes(error.value)) { selected.value = undefined; items.value = []; note.value = ''; body.value = ''; editBase.value = { revision: 0, state: 'new', note: '' }; pendingReply.value = undefined; pendingUpdate.value = undefined; }
}
async function load(after = '') {
  if (busy.value) return;
  busy.value = true; error.value = ''; success.value = '';
  try {
    const page = await http.json('/api/v1/moderation/feedback', parsePage, { query: { after, state: filter.value, limit: 25 } });
    items.value = page.items; next.value = page.next_cursor;
  } catch (error_) { failed(error_); }
  finally { busy.value = false; }
}
async function open(id: string) {
  if (busy.value || pendingReply.value || pendingUpdate.value) return;
  if (dirty.value && !window.confirm(t('page.common.leaveUnsaved'))) return;
  busy.value = true; error.value = ''; success.value = '';
  try {
    const message = await http.json(`/api/v1/moderation/feedback/${encodeURIComponent(id)}`, parseMessage);
    adopt(message); body.value = '';
  } catch (error_) { failed(error_); }
  finally { busy.value = false; }
}
async function save() {
  if (busy.value || !selected.value || pendingReply.value) return;
  pendingUpdate.value ??= { id: selected.value.id, key: crypto.randomUUID(), body: { revision: editBase.value.revision, state: state.value, note: note.value } };
  const request = pendingUpdate.value;
  busy.value = true; error.value = ''; success.value = '';
  try {
    adopt(await http.json(`/api/v1/moderation/feedback/${encodeURIComponent(request.id)}`, parseMessage, { method: 'PATCH', key: request.key, body: request.body }));
    pendingUpdate.value = undefined; success.value = 'saved';
    items.value = items.value.map((item) => item.id === selected.value?.id ? selected.value : item);
  } catch (error_) {
    failed(error_);
    if (!isUncertain(error_)) pendingUpdate.value = undefined;
  } finally { busy.value = false; }
}
async function send() {
  if (busy.value || !selected.value || pendingUpdate.value || !body.value.trim()) return;
  pendingReply.value ??= { id: selected.value.id, key: crypto.randomUUID(), body: body.value };
  const request = pendingReply.value;
  busy.value = true; error.value = ''; success.value = '';
  try {
    const reply = await http.json(`/api/v1/moderation/feedback/${encodeURIComponent(request.id)}/replies`, parseReply, { method: 'POST', key: request.key, body: { body: request.body }, timeout: 40_000 });
    pendingReply.value = undefined; body.value = ''; success.value = reply.state;
    const fresh = await http.json(`/api/v1/moderation/feedback/${encodeURIComponent(request.id)}`, parseMessage);
    if (editDirty.value) selected.value = fresh;
    else adopt(fresh);
  } catch (error_) { failed(error_); if (!isUncertain(error_)) pendingReply.value = undefined; }
  finally { busy.value = false; }
}
async function download(attachment: components['schemas']['FeedbackAttachment']) {
  if (busy.value || !selected.value) return;
  busy.value = true; error.value = '';
  try {
    const blob = await http.blob(`/api/v1/moderation/feedback/${encodeURIComponent(selected.value.id)}/attachments/${encodeURIComponent(attachment.id)}`, 5 * 1024 * 1024);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = attachment.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error_) { failed(error_); }
  finally { busy.value = false; }
}
onMounted(() => load());
</script>

<template>
  <AdminPage :title="t('page.feedback.title')" :description="t('page.feedback.description', { address: contactAddress })">
    <div class="flex flex-col gap-4" :aria-busy="busy">
      <p v-if="busy" role="status">{{ t('page.feedback.loading') }}</p>
      <p v-if="error" role="alert" class="text-destructive">{{ errorText(error) }}</p>
      <p v-if="success" role="status">{{ t(`page.feedback.${success}`) }}</p>
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1">{{ t('page.feedback.filter') }}
          <select :aria-label="t('page.feedback.filter')" v-model="filter" class="bg-background rounded border p-2" :disabled="busy" @change="load()">
            <option value="">{{ t('page.feedback.all') }}</option>
            <option v-for="value in states" :key="value" :value="value">{{ t(`page.feedback.${value}`) }}</option>
          </select>
        </label>
        <button class="rounded border px-4 py-2" type="button" :disabled="busy" @click="load()">{{ t('page.feedback.refresh') }}</button>
        <a class="underline" href="mailto:feedback@stuhelper.com">{{ contactAddress }}</a>
      </div>
      <p v-if="!busy && items.length === 0">{{ t('page.feedback.empty') }}</p>
      <div class="grid min-w-0 gap-4 lg:grid-cols-2">
        <section class="min-w-0" :aria-label="t('page.feedback.title')">
          <ul class="flex flex-col gap-2">
            <li v-for="item in items" :key="item.id">
              <button class="bg-card flex w-full flex-col gap-1 rounded border p-4 text-start disabled:opacity-60" :disabled="busy || !!pendingReply || !!pendingUpdate" @click="open(item.id)">
                <strong class="break-all">{{ item.subject || t('page.feedback.noSubject') }}</strong>
                <span class="break-all">{{ item.sender }}</span>
                <span>{{ t(`page.feedback.${item.state}`) }} <span v-if="item.suspicious">· {{ t('page.feedback.suspicious') }}</span></span>
                <time :datetime="item.received_at">{{ format.dateTime(item.received_at) }}</time>
              </button>
            </li>
          </ul>
          <button v-if="next" class="mt-3 rounded border px-4 py-2" :disabled="busy" @click="load(next)">{{ t('page.feedback.next') }}</button>
        </section>
        <section v-if="selected" class="bg-card flex min-w-0 flex-col gap-4 rounded border p-4" :aria-label="t('page.feedback.details')">
          <h2 class="break-all text-lg font-semibold">{{ selected.subject || t('page.feedback.noSubject') }}</h2>
          <p class="break-all">{{ t('page.feedback.sender') }}: {{ selected.sender }}</p>
          <p v-if="selected.suspicious" class="rounded border p-2">{{ t('page.feedback.suspiciousHelp') }}</p>
          <details><summary>{{ t('page.feedback.authentication') }}</summary><pre class="whitespace-pre-wrap break-all text-sm">{{ selected.authentication_results || t('page.feedback.missing') }}</pre></details>
          <p class="whitespace-pre-wrap break-words">{{ selected.body }}</p>
          <ul v-if="selected.attachments.length > 0" class="flex flex-col gap-2" :aria-label="t('page.feedback.attachments')">
            <li v-for="attachment in selected.attachments" :key="attachment.id" class="break-all">
              <button v-if="attachment.status === 'stored'" class="underline" :disabled="busy" @click="download(attachment)">{{ attachment.name }} {{ format.bytes(attachment.size) }}</button>
              <span v-else>{{ attachment.name }} {{ t('page.feedback.rejected') }}</span>
            </li>
          </ul>
          <p class="break-all">{{ t('page.feedback.assignee') }}: {{ selected.assignee || t('page.feedback.unassigned') }}</p>
          <form class="flex flex-col gap-3" @submit.prevent="save">
            <label class="flex flex-col gap-1">{{ t('page.feedback.state') }}
              <select :aria-label="t('page.feedback.state')" v-model="state" class="bg-background rounded border p-2" :disabled="busy || !!pendingUpdate || !!pendingReply"><option v-for="value in states" :key="value" :value="value">{{ t(`page.feedback.${value}`) }}</option></select>
            </label>
            <label class="flex flex-col gap-1">{{ t('page.feedback.note') }}<textarea v-model="note" rows="3" maxlength="2500" class="bg-background rounded border p-2" :disabled="busy || !!pendingUpdate || !!pendingReply"></textarea></label>
            <p v-if="pendingUpdate" role="status">{{ t('page.feedback.retryPending') }}</p>
            <button class="bg-primary text-primary-foreground rounded px-4 py-2" :disabled="busy || !!pendingReply" type="submit">{{ t(pendingUpdate ? 'page.feedback.retry' : 'page.feedback.save') }}</button>
          </form>
          <h3 class="font-semibold">{{ t('page.feedback.replies') }}</h3>
          <article v-for="reply in selected.replies" :key="reply.id" class="rounded border p-3">
            <p>{{ t(`page.feedback.${reply.state}`) }} · {{ reply.actor }}</p><p class="whitespace-pre-wrap break-words">{{ reply.body }}</p>
          </article>
          <form class="flex flex-col gap-3" @submit.prevent="send">
            <label class="flex flex-col gap-1">{{ t('page.feedback.reply') }}<textarea v-model="body" rows="5" maxlength="5000" required class="bg-background rounded border p-2" :disabled="busy || !!pendingReply || !!pendingUpdate"></textarea></label>
            <p>{{ t('page.feedback.replyHelp', { address: contactAddress }) }}</p><p v-if="pendingReply" role="status">{{ t('page.feedback.retryPending') }}</p>
            <button class="bg-primary text-primary-foreground rounded px-4 py-2" :disabled="busy || !!pendingUpdate || !body.trim()" type="submit">{{ t(pendingReply ? 'page.feedback.retry' : 'page.feedback.send') }}</button>
          </form>
        </section>
      </div>
    </div>
  </AdminPage>
</template>
