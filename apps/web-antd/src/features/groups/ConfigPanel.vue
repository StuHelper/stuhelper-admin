<script setup lang="ts">
import type { GroupConfig, GroupConfigInput } from './api';

import { computed, reactive, ref, shallowRef, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Checkbox, CheckboxGroup, Divider, Form, FormItem, Input, InputNumber, Radio, RadioGroup, Select, Space, Switch, Textarea } from 'ant-design-vue';

import { errorCode } from '#/shared/api/errors';
import { useMutation } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useGroupsAdmin } from './api';

/**
 * Rules of one group: joining, cards, content checks and games. Durations are
 * edited in hours or days and sent in seconds. A save carries the revision the
 * edit started from, so a concurrent change is reported instead of overwritten.
 * The join password is write-only: the page only knows whether one is set.
 */
const props = defineProps<{ group: string }>();
const emit = defineEmits<{ saved: [config: GroupConfig] }>();
const { t } = useI18n();
const api = useGroupsAdmin();
const save = useMutation();
const status = ref<'error' | 'loading' | 'ready'>('loading');
const loadError = ref('');
const saved = shallowRef<GroupConfig>();
const success = ref('');
const password = ref('');
const autoActions = ['warn', 'recall', 'mute', 'kick', 'blacklist'] as const;

type Draft = Omit<GroupConfig, 'grace_seconds' | 'id' | 'number' | 'password_set' | 'reminder_seconds' | 'retention_seconds' | 'revision' | 'school'> & { grace_hours: number; reminder_hours: number; retention_days: number };
const form = reactive({} as Draft);
const hour = 3600;
const day = 86_400;

function fill(value: GroupConfig) {
  saved.value = value;
  const { grace_seconds, reminder_seconds, retention_seconds, id: _id, number: _number, password_set: _set, revision: _revision, school: _school, ...rest } = value;
  Object.assign(form, structuredClone(rest), { grace_hours: grace_seconds / hour, reminder_hours: reminder_seconds / hour, retention_days: retention_seconds / day });
  password.value = '';
}
async function load(keepDraft = false) {
  status.value = 'loading';
  loadError.value = '';
  try {
    const value = await api.config(props.group);
    if (keepDraft) saved.value = value;
    else fill(value);
    save.dismiss();
    status.value = 'ready';
  } catch (error) {
    loadError.value = errorCode(error);
    status.value = 'error';
  }
}
watch(() => props.group, () => void load(), { immediate: true });

function input(): GroupConfigInput | undefined {
  const base = saved.value;
  if (!base) return undefined;
  const { grace_hours, reminder_hours, retention_days, ...rest } = form;
  return {
    ...rest,
    id: base.id,
    school: base.school,
    name: rest.name.trim(),
    keywords: [...new Set(rest.keywords.map((word) => word.trim()).filter(Boolean))],
    grace_seconds: Math.round(grace_hours * hour),
    reminder_seconds: Math.round(reminder_hours * hour),
    retention_seconds: Math.round(retention_days * day),
    expected_revision: base.revision,
    ...(password.value ? { password: password.value } : {}),
  };
}
const dirty = computed(() => {
  const base = saved.value;
  const next = input();
  if (!base || !next) return false;
  const { expected_revision: _r, password: _p, ...fields } = next;
  return !!password.value || Object.entries(fields).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key as keyof GroupConfig]));
});
// A password group needs a password, either one already set or one typed now.
const problem = computed(() => {
  if (!form.name?.trim()) return 'name';
  if (form.grace_hours <= 0) return 'grace';
  if (form.mode === 'password' && !saved.value?.password_set && !password.value) return 'password';
  return '';
});
const locked = computed(() => save.busy.value || save.uncertain.value);
useLeaveGuard(() => (save.uncertain.value ? t('page.common.leaveUncertain') : (dirty.value ? t('page.common.leaveUnsaved') : '')));

async function submit() {
  const body = input();
  if (!body || problem.value || !dirty.value) return;
  success.value = '';
  const result = await save.run(`group-config:${props.group}`, body, (value, key) => api.saveConfig(props.group, value, key));
  if (result) done(result);
}
async function retry() {
  const result = (await save.retry()) as GroupConfig | undefined;
  if (result) done(result);
}
function done(result: GroupConfig) {
  fill(result);
  success.value = t('page.groups.config.saved');
  emit('saved', result);
}
</script>

<template>
  <LoadState v-if="status !== 'ready'" :status="status" :error="loadError" @retry="load()">
    <span></span>
  </LoadState>
  <Form v-else layout="vertical" @submit.prevent="submit">
    <div class="grid gap-x-4 md:grid-cols-2">
      <FormItem :label="t('page.groups.name')" required html-for="group-name"><Input id="group-name" v-model:value="form.name" :maxlength="128" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.bot')" html-for="group-bot"><Switch id="group-bot" v-model:checked="form.bot_enabled" :disabled="locked" /></FormItem>
    </div>

    <Divider orientation="left">{{ t('page.groups.config.joining') }}</Divider>
    <FormItem :label="t('page.groups.config.mode')">
      <RadioGroup v-model:value="form.mode" :disabled="locked">
        <Radio value="before">{{ t('page.groups.config.modes.before') }}</Radio>
        <Radio value="muted">{{ t('page.groups.config.modes.muted') }}</Radio>
        <Radio value="password">{{ t('page.groups.config.modes.password') }}</Radio>
      </RadioGroup>
    </FormItem>
    <FormItem v-if="form.mode === 'password'" :label="t('page.groups.config.password')" :extra="t(saved?.password_set ? 'page.groups.config.passwordKeep' : 'page.groups.config.passwordNew')" html-for="group-password">
      <Input id="group-password" v-model:value="password" type="password" autocomplete="new-password" :maxlength="128" :disabled="locked" />
    </FormItem>
    <Space wrap class="mb-4">
      <Checkbox v-model:checked="form.require_student" :disabled="locked">{{ t('page.groups.requireStudent') }}</Checkbox>
      <Checkbox v-model:checked="form.accept_alumni" :disabled="locked || !form.require_student">{{ t('page.groups.config.acceptAlumni') }}</Checkbox>
      <Checkbox v-model:checked="form.accept_temporary" :disabled="locked || !form.require_student">{{ t('page.groups.config.acceptTemporary') }}</Checkbox>
    </Space>
    <div class="grid gap-x-4 md:grid-cols-3">
      <FormItem :label="t('page.groups.config.graceHours')" :extra="t('page.groups.config.graceHint')" html-for="group-grace"><InputNumber id="group-grace" v-model:value="form.grace_hours" :min="1" :max="8760" class="w-full" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.config.reminderHours')" html-for="group-reminder"><InputNumber id="group-reminder" v-model:value="form.reminder_hours" :min="0" :max="8760" class="w-full" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.config.retentionDays')" :extra="t('page.groups.config.retentionHint')" html-for="group-retention"><InputNumber id="group-retention" v-model:value="form.retention_days" :min="0" :max="365" class="w-full" :disabled="locked" /></FormItem>
    </div>
    <FormItem :label="t('page.groups.config.welcome')" html-for="group-welcome"><Textarea id="group-welcome" v-model:value="form.welcome" :rows="2" :maxlength="2048" :disabled="locked" /></FormItem>
    <FormItem :label="t('page.groups.config.rules')" html-for="group-rules"><Textarea id="group-rules" v-model:value="form.rules_template" :rows="3" :maxlength="8192" :disabled="locked" /></FormItem>

    <Divider orientation="left">{{ t('page.groups.config.cards') }}</Divider>
    <Space wrap class="mb-4">
      <Checkbox v-model:checked="form.check_card" :disabled="locked">{{ t('page.groups.config.checkCard') }}</Checkbox>
      <Checkbox v-model:checked="form.remind_card" :disabled="locked">{{ t('page.groups.config.remindCard') }}</Checkbox>
      <Checkbox v-model:checked="form.auto_card" :disabled="locked">{{ t('page.groups.config.autoCard') }}</Checkbox>
    </Space>
    <FormItem :label="t('page.groups.config.cardTemplate')" :extra="t('page.groups.config.cardTemplateHint')" html-for="group-card"><Input id="group-card" v-model:value="form.card_template" :maxlength="1024" :disabled="locked" /></FormItem>

    <Divider orientation="left">{{ t('page.groups.config.content') }}</Divider>
    <FormItem :label="t('page.groups.config.keywords')" :extra="t('page.groups.config.keywordsHint')" html-for="group-keywords">
      <Select id="group-keywords" v-model:value="form.keywords" mode="tags" :max-tag-count="20" :token-separators="[',', '，']" :disabled="locked" :open="false" />
    </FormItem>
    <Checkbox v-model:checked="form.block_links" class="mb-4" :disabled="locked">{{ t('page.groups.config.blockLinks') }}</Checkbox>
    <div class="grid gap-x-4 md:grid-cols-4">
      <FormItem :label="t('page.groups.config.frequencySeconds')" html-for="group-frequency-seconds"><InputNumber id="group-frequency-seconds" v-model:value="form.frequency_seconds" :min="0" :max="86400" class="w-full" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.config.frequencyLimit')" html-for="group-frequency-limit"><InputNumber id="group-frequency-limit" v-model:value="form.frequency_limit" :min="0" :max="10000" class="w-full" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.config.repeatThreshold')" html-for="group-repeat"><InputNumber id="group-repeat" v-model:value="form.repeat_threshold" :min="0" :max="1000" class="w-full" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.config.warningLimit')" html-for="group-warnings"><InputNumber id="group-warnings" v-model:value="form.warning_limit" :min="0" :max="10000" class="w-full" :disabled="locked" /></FormItem>
    </div>
    <p class="text-muted-foreground -mt-2 mb-3 text-xs">{{ t('page.groups.config.zeroOff') }}</p>
    <FormItem :label="t('page.groups.config.autoActions')" :extra="t('page.groups.config.autoActionsHint')">
      <CheckboxGroup v-model:value="form.auto_actions" :disabled="locked">
        <Checkbox v-for="kind in autoActions" :key="kind" :value="kind">{{ t(`page.groups.commands.${kind}`) }}</Checkbox>
      </CheckboxGroup>
    </FormItem>

    <Divider orientation="left">{{ t('page.groups.config.games') }}</Divider>
    <div class="grid gap-x-4 md:grid-cols-5">
      <FormItem :label="t('page.groups.config.diceSides')" html-for="group-dice"><InputNumber id="group-dice" v-model:value="form.dice_sides" :min="0" :max="1000000" class="w-full" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.config.muteProbability')" html-for="group-mute-probability"><InputNumber id="group-mute-probability" v-model:value="form.mute_probability" :min="0" :max="100" class="w-full" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.config.muteSeconds')" html-for="group-mute-seconds"><InputNumber id="group-mute-seconds" v-model:value="form.mute_seconds" :min="0" :max="2592000" class="w-full" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.config.cooldownSeconds')" html-for="group-cooldown"><InputNumber id="group-cooldown" v-model:value="form.cooldown_seconds" :min="0" :max="31536000" class="w-full" :disabled="locked" /></FormItem>
      <FormItem :label="t('page.groups.config.pity')" html-for="group-pity"><InputNumber id="group-pity" v-model:value="form.pity" :min="0" :max="10000" class="w-full" :disabled="locked" /></FormItem>
    </div>

    <Alert v-if="problem && dirty" class="mb-3" type="warning" show-icon :message="t(`page.groups.config.problems.${problem}`)" />
    <MutationAlert :busy="save.busy.value" :error="save.error.value" :uncertain="save.uncertain.value" :success="success" @retry="retry" />
    <Space class="mt-4" wrap>
      <Button type="primary" html-type="submit" :loading="save.busy.value" :disabled="save.uncertain.value || !dirty || !!problem">{{ t('page.common.save') }}</Button>
      <Button v-if="save.error.value === 'conflict'" :disabled="locked" @click="load(true)">{{ t('page.common.reloadCompare') }}</Button>
      <Button :disabled="locked || !dirty" @click="saved && fill(saved)">{{ t('page.common.discard') }}</Button>
    </Space>
  </Form>
</template>
