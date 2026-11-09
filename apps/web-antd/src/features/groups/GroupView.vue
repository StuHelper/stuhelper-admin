<script setup lang="ts">
import type { Action, Blacklist, GroupConfig, Hit, ManageCommand, Member, Report } from './api';

import { computed, onMounted, reactive, ref, shallowRef } from 'vue';
import { RouterLink } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Form, FormItem, InputNumber, Modal, Select, TabPane, Tabs, Tag, Textarea } from 'ant-design-vue';

import { useMutation } from '#/shared/composables/async';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { isSet, useGroupsAdmin } from './api';
import ListPanel from './ListPanel.vue';

/**
 * One group: its rules, members and their eligibility, bot actions, reports,
 * rule hits and blacklist. Member commands go to the bot through the server,
 * which checks the viewer's group-scoped grant for each command; an action whose
 * bot outcome is not yet confirmed shows as unknown until the server checks it.
 */
const props = defineProps<{ id: string }>();
const { t, te } = useI18n();
const format = useFormat();
const api = useGroupsAdmin();
const label = (key: string, fallback: string) => (te(key) ? t(key) : fallback);
const config = shallowRef<GroupConfig>();
// The header names the group; the rules themselves load in their own tab.
onMounted(async () => {
  try {
    config.value = await api.config(props.id);
  } catch {
    // Each tab reports its own loading failure.
  }
});
const tab = ref('members');
const panels = reactive<Record<string, undefined | { reload: () => Promise<void> }>>({});

const time = (value?: string) => (isSet(value) ? format.value.dateTime(value!) : '—');
const memberColumns = computed(() => [
  { key: 'owner', title: t('page.groups.member') },
  { key: 'state', title: t('page.groups.state'), width: 150 },
  { key: 'deadline', title: t('page.groups.deadline'), width: 180 },
  { key: 'flags', title: t('page.groups.flags'), width: 200 },
  { key: 'actions', title: t('page.common.operation'), width: 110 },
]);
const actionColumns = computed(() => [
  { key: 'created', title: t('page.groups.time'), width: 180 },
  { key: 'command', title: t('page.groups.command') },
  { key: 'actor', title: t('page.groups.actor') },
  { key: 'state', title: t('page.groups.state'), width: 130 },
]);
const reportColumns = computed(() => [
  { key: 'reason', title: t('page.groups.reason') },
  { key: 'reporter', title: t('page.groups.reporter') },
  { key: 'analysis', title: t('page.groups.analysis') },
  { key: 'state', title: t('page.groups.state'), width: 130 },
]);
const hitColumns = computed(() => [
  { key: 'owner', title: t('page.groups.member') },
  { key: 'rules', title: t('page.groups.rules') },
  { key: 'state', title: t('page.groups.state'), width: 130 },
]);
const blacklistColumns = computed(() => [
  { key: 'id', title: t('page.groups.member') },
  { key: 'reason', title: t('page.groups.reason') },
  { key: 'until', title: t('page.groups.until'), width: 180 },
  { key: 'actions', title: t('page.common.operation'), width: 110 },
]);
const actionColor: Record<string, string> = { succeeded: 'green', failed: 'red', unknown: 'orange', pending: 'blue', executing: 'blue', cancelled: 'default' };

// Commands on one member. Reason text is required where the contract requires it.
type Kind = ManageCommand['kind'];
const memberKinds: Kind[] = ['recheck', 'extend', 'exempt', 'warn', 'mute', 'unmute', 'kick', 'blacklist'];
const needsText = new Set<Kind>(['blacklist', 'exempt', 'extend', 'warn']);
const needsSeconds = new Set<Kind>(['extend', 'mute']);
const draft = reactive({ open: false, target: '', kind: 'recheck' as Kind, text: '', minutes: 60 });
const command = useMutation();
const result = ref('');
const ready = computed(() => (!needsText.has(draft.kind) || !!draft.text.trim()) && (!needsSeconds.has(draft.kind) || draft.minutes > 0));
function start(target: string, kind: Kind = 'recheck') {
  Object.assign(draft, { open: true, target, kind, text: '', minutes: 60 });
  command.dismiss();
  result.value = '';
}
function body(): ManageCommand {
  const text = draft.text.trim();
  const seconds = Math.round(draft.minutes * 60);
  switch (draft.kind) {
    case 'blacklist': {
      return { kind: 'blacklist', target: draft.target, text, seconds };
    }
    case 'exempt':
    case 'warn': {
      return { kind: draft.kind, target: draft.target, text };
    }
    case 'extend': {
      return { kind: 'extend', target: draft.target, text, seconds };
    }
    case 'kick': {
      return { kind: 'kick', target: draft.target, ...(text ? { text } : {}) };
    }
    case 'mute': {
      return { kind: 'mute', target: draft.target, seconds, ...(text ? { text } : {}) };
    }
    default: {
      return { kind: draft.kind, target: draft.target } as ManageCommand;
    }
  }
}
async function send() {
  if (!ready.value) return;
  const value = await command.run(`group-command:${props.id}:${draft.target}`, body(), (payload, key) => api.command(props.id, payload, key));
  if (value) finish(value.state);
}
async function retry() {
  const value = (await command.retry()) as undefined | { state: string };
  if (value) finish(value.state);
}
function finish(state: string) {
  result.value = t('page.groups.commandSent', { state: label(`page.groups.states.${state}`, state) });
  void panels.members?.reload();
  void panels.actions?.reload();
  void panels.blacklist?.reload();
}
</script>

<template>
  <AdminPage :title="config?.name ?? t('page.groups.title')" :description="config ? t('page.groups.detailIntro', { number: config.number }) : ''">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <RouterLink to="/qq/groups">{{ t('page.groups.back') }}</RouterLink>
      <RouterLink :to="`/qq/groups/${encodeURIComponent(id)}/settings`"><Button>{{ t('page.groups.tabs.config') }}</Button></RouterLink>
    </div>
    <Card :bordered="false">
      <Tabs v-model:active-key="tab">
        <TabPane key="members" :tab="t('page.groups.tabs.members')">
          <ListPanel :ref="(el) => (panels.members = el as never)" :columns="memberColumns" :empty-text="t('page.groups.emptyMembers')" :loader="(cursor, signal) => api.members(id, cursor, signal)" :row-key="(row: Member) => row.owner">
            <template #cell="{ column, record }">
              <code v-if="column.key === 'owner'" class="break-all text-xs">{{ record.owner }}</code>
              <Tag v-else-if="column.key === 'state'">{{ label(`page.groups.memberStates.${record.state}`, record.state) }}</Tag>
              <template v-else-if="column.key === 'deadline'">{{ time(record.deadline) }}</template>
              <template v-else-if="column.key === 'flags'">
                <Tag v-if="record.exempt" color="blue">{{ t('page.groups.exempt') }}</Tag>
                <Tag v-if="record.extended" color="blue">{{ t('page.groups.extended') }}</Tag>
                <Tag v-if="isSet(record.muted_until)" color="orange">{{ t('page.groups.mutedUntil', { time: time(record.muted_until) }) }}</Tag>
                <Tag v-if="!record.joined">{{ t('page.groups.notJoined') }}</Tag>
              </template>
              <Button v-else-if="column.key === 'actions'" size="small" @click="start(record.owner)">{{ t('page.groups.manage') }}</Button>
            </template>
          </ListPanel>
        </TabPane>
        <TabPane key="actions" :tab="t('page.groups.tabs.actions')">
          <Alert class="mb-3" type="info" show-icon :message="t('page.groups.unknownHint')" />
          <ListPanel :ref="(el) => (panels.actions = el as never)" :columns="actionColumns" :empty-text="t('page.groups.emptyActions')" :loader="(cursor, signal) => api.actions(id, cursor, signal)" :row-key="(row: Action) => row.id">
            <template #cell="{ column, record }">
              <template v-if="column.key === 'created'">{{ time(record.created) }}</template>
              <template v-else-if="column.key === 'command'">{{ label(`page.groups.commands.${record.command.kind}`, record.command.kind) }} <code v-if="record.command.target" class="break-all text-xs">{{ record.command.target }}</code></template>
              <code v-else-if="column.key === 'actor'" class="break-all text-xs">{{ record.actor.subject }}</code>
              <Tag v-else-if="column.key === 'state'" :color="actionColor[record.state] ?? 'default'">{{ label(`page.groups.states.${record.state}`, record.state) }}</Tag>
            </template>
          </ListPanel>
        </TabPane>
        <TabPane key="reports" :tab="t('page.groups.tabs.reports')">
          <ListPanel :columns="reportColumns" :empty-text="t('page.groups.emptyReports')" :loader="(cursor, signal) => api.reports(id, cursor, signal)" :row-key="(row: Report) => row.id">
            <template #cell="{ column, record }">
              <template v-if="column.key === 'reason'">{{ record.reason }}</template>
              <code v-else-if="column.key === 'reporter'" class="break-all text-xs">{{ record.reporter }}</code>
              <template v-else-if="column.key === 'analysis'">{{ record.analysis || '—' }}<div v-if="record.suggestions?.length" class="text-muted-foreground text-xs">{{ format.list(record.suggestions.map((kind: string) => label(`page.groups.commands.${kind}`, kind))) }}</div></template>
              <Tag v-else-if="column.key === 'state'">{{ label(`page.groups.reportStates.${record.state}`, record.state) }}</Tag>
            </template>
          </ListPanel>
        </TabPane>
        <TabPane key="hits" :tab="t('page.groups.tabs.hits')">
          <ListPanel :columns="hitColumns" :empty-text="t('page.groups.emptyHits')" :loader="(cursor, signal) => api.hits(id, cursor, signal)" :row-key="(row: Hit) => row.id">
            <template #cell="{ column, record }">
              <code v-if="column.key === 'owner'" class="break-all text-xs">{{ record.owner }}</code>
              <template v-else-if="column.key === 'rules'">{{ format.list(record.rules) }}</template>
              <Tag v-else-if="column.key === 'state'">{{ label(`page.groups.hitStates.${record.state}`, record.state) }}</Tag>
            </template>
          </ListPanel>
        </TabPane>
        <TabPane key="blacklist" :tab="t('page.groups.tabs.blacklist')">
          <ListPanel :ref="(el) => (panels.blacklist = el as never)" :columns="blacklistColumns" :empty-text="t('page.groups.emptyBlacklist')" :loader="(cursor, signal) => api.blacklist(id, cursor, signal)" :row-key="(row: Blacklist) => row.id">
            <template #cell="{ column, record }">
              <code v-if="column.key === 'id'" class="break-all text-xs">{{ record.id }}</code>
              <template v-else-if="column.key === 'reason'">{{ record.reason }}</template>
              <template v-else-if="column.key === 'until'">{{ record.permanent ? t('page.groups.permanent') : time(record.until) }}</template>
              <Button v-else-if="column.key === 'actions'" size="small" @click="start(record.id, 'unblacklist')">{{ t('page.groups.commands.unblacklist') }}</Button>
            </template>
          </ListPanel>
        </TabPane>
      </Tabs>
    </Card>

    <Modal v-model:open="draft.open" :title="t('page.groups.commandTitle')" :footer="null" destroy-on-close>
      <Form layout="vertical" @submit.prevent="send">
        <p class="text-sm">{{ t('page.groups.commandTarget') }} <code class="break-all text-xs">{{ draft.target }}</code></p>
        <FormItem :label="t('page.groups.command')" html-for="group-command-kind">
          <Select id="group-command-kind" v-model:value="draft.kind" :disabled="command.busy.value || command.uncertain.value" :options="(draft.kind === 'unblacklist' ? ['unblacklist'] : memberKinds).map((value) => ({ value, label: t(`page.groups.commands.${value}`) }))" />
        </FormItem>
        <p class="text-muted-foreground text-xs">{{ t(`page.groups.commandHints.${draft.kind}`) }}</p>
        <FormItem v-if="needsSeconds.has(draft.kind) || draft.kind === 'blacklist'" :label="t(draft.kind === 'blacklist' ? 'page.groups.blacklistMinutes' : 'page.groups.minutes')" html-for="group-command-minutes">
          <InputNumber id="group-command-minutes" v-model:value="draft.minutes" :min="draft.kind === 'blacklist' ? 0 : 1" :max="draft.kind === 'mute' ? 43200 : 525600" class="w-full" :disabled="command.busy.value || command.uncertain.value" />
        </FormItem>
        <FormItem v-if="!['recheck', 'unmute', 'unblacklist'].includes(draft.kind)" :label="t('page.groups.reason')" :required="needsText.has(draft.kind)" html-for="group-command-text">
          <Textarea id="group-command-text" v-model:value="draft.text" :rows="2" :maxlength="1000" :disabled="command.busy.value || command.uncertain.value" />
        </FormItem>
        <MutationAlert :busy="command.busy.value" :error="command.error.value" :uncertain="command.uncertain.value" :success="result" @retry="retry" />
        <Button class="mt-3" type="primary" html-type="submit" :danger="['kick', 'blacklist'].includes(draft.kind)" :loading="command.busy.value" :disabled="!ready || command.uncertain.value || !!result">{{ t('page.groups.send') }}</Button>
      </Form>
    </Modal>
  </AdminPage>
</template>
