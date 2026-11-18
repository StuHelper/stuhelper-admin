<script setup lang="ts">
import type { components } from '#/api/moderation.gen';

import { computed, onMounted, ref } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Form, FormItem, Select, Space, Tag, Textarea } from 'ant-design-vue';

import { saveBlob } from '#/shared/api/http';
import { schemaOf } from '#/shared/api/schema';
import { useMutation, usePaged, useTask } from '#/shared/composables/async';
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
// The detail contains at most 100 replies of 20,000 UTF-8 bytes each. Go's JSON
// escaping can expand those bytes sixfold; keep a fixed budget for that contract.
const detailOptions = { maxJsonBytes: 16 * 1024 * 1024 };
const format = useFormat();
const errorText = useErrorText();
const parsePage = schemaOf<components['schemas']['FeedbackPage']>(contract.components.schemas, 'FeedbackPage');
const parseMessage = schemaOf<Feedback>(contract.components.schemas, 'Feedback');
const parseReply = schemaOf<components['schemas']['FeedbackReply']>(contract.components.schemas, 'FeedbackReply');

const selected = ref<Feedback>();
const state = ref<Feedback['state']>('new');
const filter = ref('');
const note = ref('');
const body = ref('');
const success = ref('');
const states: Feedback['state'][] = ['new', 'processing', 'resolved', 'spam'];
const stateColor: Record<Feedback['state'], string> = { new: 'blue', processing: 'gold', resolved: 'green', spam: 'default' };
// A details refresh must not silently upgrade the revision of an existing draft.
const editBase = ref({ revision: 0, state: 'new', note: '' });

function clearDetail() {
  selected.value = undefined;
  note.value = '';
  body.value = '';
  success.value = '';
  editBase.value = { revision: 0, state: 'new', note: '' };
}

const messages = usePaged<Feedback>(
  async (after, signal) => {
    const page = await http.json('/api/v1/moderation/feedback', parsePage, {
      query: { after, state: filter.value, limit: 25 },
      signal,
    });
    return { items: page.items, next: page.next_cursor };
  },
  { onDenied: clearDetail },
);
function clearPrivate() {
  messages.clear();
  clearDetail();
}
const opening = useTask({ onDenied: clearPrivate });
const downloading = useTask({ onDenied: clearPrivate });
const updateWrite = useMutation({ onDenied: clearPrivate });
const replyWrite = useMutation({ onDenied: clearPrivate });

const busy = computed(
  () =>
    messages.status.value === 'loading' ||
    opening.busy.value ||
    downloading.busy.value ||
    updateWrite.busy.value ||
    replyWrite.busy.value,
);
const activeError = computed(
  () =>
    updateWrite.error.value ||
    replyWrite.error.value ||
    opening.error.value ||
    downloading.error.value ||
    messages.error.value,
);
const editDirty = computed(
  () =>
    !!selected.value &&
    (state.value !== editBase.value.state || note.value !== editBase.value.note),
);
const dirty = computed(() => editDirty.value || !!body.value);
useLeaveGuard(() =>
  replyWrite.uncertain.value || updateWrite.uncertain.value
    ? t('page.common.leaveUncertain')
    : (dirty.value ? t('page.common.leaveUnsaved') : ''),
);

function adopt(message: Feedback) {
  selected.value = message;
  state.value = message.state;
  note.value = message.note;
  editBase.value = { revision: message.revision, state: message.state, note: message.note };
}

function reloadList() {
  success.value = '';
  updateWrite.dismiss();
  replyWrite.dismiss();
  void messages.reload();
}

async function open(id: string) {
  if (busy.value || replyWrite.uncertain.value || updateWrite.uncertain.value) return;
  if (dirty.value && !window.confirm(t('page.common.leaveUnsaved'))) return;
  success.value = '';
  updateWrite.dismiss();
  replyWrite.dismiss();
  const message = await opening.run(() =>
    http.json(`/api/v1/moderation/feedback/${encodeURIComponent(id)}`, parseMessage, detailOptions),
  );
  if (message) {
    adopt(message);
    body.value = '';
  }
}

async function save() {
  const current = selected.value;
  if (busy.value || !current || replyWrite.uncertain.value) return;
  success.value = '';
  const targetId = current.id;
  const payload: components['schemas']['FeedbackUpdate'] = {
    revision: editBase.value.revision,
    state: state.value,
    note: note.value,
  };
  const updated = (await (updateWrite.uncertain.value
    ? updateWrite.retry()
    : updateWrite.run(
        `feedback-update:${targetId}:${payload.revision}:${payload.state}:${payload.note}`,
        payload,
        (value, key) =>
          http.json(`/api/v1/moderation/feedback/${encodeURIComponent(targetId)}`, parseMessage, {
            ...detailOptions,
            method: 'PATCH',
            key,
            body: value,
          }),
      ))) as Feedback | undefined;
  if (!updated) return;
  adopt(updated);
  success.value = 'saved';
  messages.items.value = messages.items.value.map((item) =>
    item.id === updated.id ? updated : item,
  );
}

async function send() {
  const current = selected.value;
  if (busy.value || !current || updateWrite.uncertain.value) return;
  if (!replyWrite.uncertain.value && !body.value.trim()) return;
  success.value = '';
  const targetId = current.id;
  const reply = (await (replyWrite.uncertain.value
    ? replyWrite.retry()
    : replyWrite.run(
        `feedback-reply:${targetId}:${body.value}`,
        { body: body.value },
        (value, key) =>
          http.json(`/api/v1/moderation/feedback/${encodeURIComponent(targetId)}/replies`, parseReply, {
            method: 'POST',
            key,
            body: value,
            timeout: 40_000,
          }),
      ))) as components['schemas']['FeedbackReply'] | undefined;
  if (!reply) return;
  body.value = '';
  success.value = reply.state;
  const fresh = await opening.run(() =>
    http.json(`/api/v1/moderation/feedback/${encodeURIComponent(targetId)}`, parseMessage, detailOptions),
  );
  if (!fresh) return;
  if (editDirty.value) selected.value = fresh;
  else adopt(fresh);
}

async function download(attachment: components['schemas']['FeedbackAttachment']) {
  const current = selected.value;
  if (busy.value || !current) return;
  const blob = await downloading.run(() =>
    http.blob(
      `/api/v1/moderation/feedback/${encodeURIComponent(current.id)}/attachments/${encodeURIComponent(attachment.id)}`,
      5 * 1024 * 1024,
    ),
  );
  if (blob) saveBlob(blob, attachment.name);
}

const filterOptions = computed(() => [
  { value: '', label: t('page.feedback.all') },
  ...states.map((value) => ({ value, label: t(`page.feedback.${value}`) })),
]);
const stateOptions = computed(() =>
  states.map((value) => ({ value, label: t(`page.feedback.${value}`) })),
);

onMounted(() => {
  void messages.reload();
});
</script>

<template>
  <AdminPage :title="t('page.feedback.title')" :description="t('page.feedback.description', { address: contactAddress })">
    <div class="flex flex-col gap-4" :aria-busy="busy">
      <p v-if="busy" role="status">{{ t('page.feedback.loading') }}</p>
      <Alert v-if="activeError" type="error" show-icon role="alert" :message="errorText(activeError)" />
      <Alert v-if="success" type="success" show-icon role="status" :message="t(`page.feedback.${success}`)" />
      <Card :bordered="false">
        <Space wrap align="end">
          <div class="flex flex-col gap-1">
            <span class="text-sm">{{ t('page.feedback.filter') }}</span>
            <Select
              v-model:value="filter"
              class="w-44 max-w-full"
              :aria-label="t('page.feedback.filter')"
              :disabled="busy"
              :options="filterOptions"
              @change="reloadList"
            />
          </div>
          <Button html-type="button" :disabled="busy" @click="reloadList">{{ t('page.feedback.refresh') }}</Button>
          <a class="text-sm underline" href="mailto:feedback@stuhelper.com">{{ contactAddress }}</a>
        </Space>
      </Card>
      <p v-if="!busy && messages.items.value.length === 0" class="text-muted-foreground">{{ t('page.feedback.empty') }}</p>
      <div class="grid min-w-0 gap-4 lg:grid-cols-2">
        <section class="min-w-0" :aria-label="t('page.feedback.title')">
          <ul class="flex flex-col gap-2">
            <li v-for="item in messages.items.value" :key="item.id">
              <button
                type="button"
                class="bg-card hover:border-primary flex w-full flex-col gap-1 rounded border p-4 text-start transition-colors disabled:opacity-60"
                :disabled="busy || replyWrite.uncertain.value || updateWrite.uncertain.value"
                @click="open(item.id)"
              >
                <strong class="break-all">{{ item.subject || t('page.feedback.noSubject') }}</strong>
                <span class="text-muted-foreground break-all text-sm">{{ item.sender }}</span>
                <span class="flex flex-wrap items-center gap-1 text-xs">
                  <Tag :color="stateColor[item.state]">{{ t(`page.feedback.${item.state}`) }}</Tag>
                  <Tag v-if="item.suspicious" color="orange">{{ t('page.feedback.suspicious') }}</Tag>
                </span>
                <time class="text-muted-foreground text-xs" :datetime="item.received_at">{{ format.dateTime(item.received_at) }}</time>
              </button>
            </li>
          </ul>
          <div v-if="messages.next.value" class="mt-3">
            <Button :loading="messages.appending.value" :disabled="busy" @click="messages.loadMore">{{ t('page.feedback.next') }}</Button>
          </div>
        </section>
        <Card v-if="selected" :bordered="false" class="min-w-0" :aria-label="t('page.feedback.details')">
          <div class="flex min-w-0 flex-col gap-4">
            <h2 class="break-all text-lg font-semibold">{{ selected.subject || t('page.feedback.noSubject') }}</h2>
            <p class="break-all">{{ t('page.feedback.sender') }}: {{ selected.sender }}</p>
            <Alert v-if="selected.suspicious" role="note" type="warning" show-icon :message="t('page.feedback.suspiciousHelp')" />
            <details>
              <summary class="cursor-pointer text-sm">{{ t('page.feedback.authentication') }}</summary>
              <pre class="whitespace-pre-wrap break-all text-sm">{{ selected.authentication_results || t('page.feedback.missing') }}</pre>
            </details>
            <p class="whitespace-pre-wrap break-words">{{ selected.body }}</p>
            <ul v-if="selected.attachments.length > 0" class="flex flex-col gap-2" :aria-label="t('page.feedback.attachments')">
              <li v-for="attachment in selected.attachments" :key="attachment.id" class="break-all">
                <Button v-if="attachment.status === 'stored'" type="link" size="small" class="p-0" :disabled="busy" @click="download(attachment)">
                  {{ attachment.name }} {{ format.bytes(attachment.size) }}
                </Button>
                <span v-else>{{ attachment.name }} {{ t('page.feedback.rejected') }}</span>
              </li>
            </ul>
            <p class="break-all">{{ t('page.feedback.assignee') }}: {{ selected.assignee || t('page.feedback.unassigned') }}</p>
            <Form layout="vertical" @submit.prevent="save">
              <FormItem :label="t('page.feedback.state')" html-for="feedback-state">
                <Select
                  id="feedback-state"
                  v-model:value="state"
                  :aria-label="t('page.feedback.state')"
                  :disabled="busy || updateWrite.uncertain.value || replyWrite.uncertain.value"
                  :options="stateOptions"
                />
              </FormItem>
              <FormItem :label="t('page.feedback.note')" html-for="feedback-note">
                <Textarea
                  id="feedback-note"
                  v-model:value="note"
                  :rows="3"
                  :maxlength="2500"
                  :disabled="busy || updateWrite.uncertain.value || replyWrite.uncertain.value"
                />
              </FormItem>
              <p v-if="updateWrite.uncertain.value" role="status" class="mb-2 text-sm">{{ t('page.feedback.retryPending') }}</p>
              <Button type="primary" html-type="submit" :loading="updateWrite.busy.value" :disabled="busy || replyWrite.uncertain.value">
                {{ t(updateWrite.uncertain.value ? 'page.feedback.retry' : 'page.feedback.save') }}
              </Button>
            </Form>
            <h3 class="font-semibold">{{ t('page.feedback.replies') }}</h3>
            <article v-for="reply in selected.replies" :key="reply.id" class="rounded border p-3">
              <p class="text-muted-foreground text-xs">{{ t(`page.feedback.${reply.state}`) }} · {{ reply.actor }}</p>
              <p class="whitespace-pre-wrap break-words">{{ reply.body }}</p>
            </article>
            <Form layout="vertical" @submit.prevent="send">
              <FormItem :label="t('page.feedback.reply')" required html-for="feedback-reply">
                <Textarea
                  id="feedback-reply"
                  v-model:value="body"
                  :rows="5"
                  :maxlength="5000"
                  required
                  :disabled="busy || replyWrite.uncertain.value || updateWrite.uncertain.value"
                />
              </FormItem>
              <p class="text-muted-foreground mb-2 text-sm">{{ t('page.feedback.replyHelp', { address: contactAddress }) }}</p>
              <p v-if="replyWrite.uncertain.value" role="status" class="mb-2 text-sm">{{ t('page.feedback.retryPending') }}</p>
              <Button
                type="primary"
                html-type="submit"
                :loading="replyWrite.busy.value"
                :disabled="busy || updateWrite.uncertain.value || (!replyWrite.uncertain.value && !body.trim())"
              >
                {{ t(replyWrite.uncertain.value ? 'page.feedback.retry' : 'page.feedback.send') }}
              </Button>
            </Form>
          </div>
        </Card>
      </div>
    </div>
  </AdminPage>
</template>
