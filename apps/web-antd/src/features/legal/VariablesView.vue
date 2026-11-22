<script setup lang="ts">
import type {
  AdminDocumentMetadata,
  CreateVariable,
  Variable,
  VariableContent,
} from './api';

import {
  computed,
  nextTick,
  onMounted,
  onScopeDispose,
  reactive,
  ref,
  shallowRef,
  useId,
} from 'vue';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Modal } from 'ant-design-vue';

import { ApiError } from '#/shared/api/errors';
import { useAsync, useMutation, usePaged } from '#/shared/composables/async';
import { useLeaveGuard } from '#/shared/composables/leave';
import { useFormat } from '#/shared/format';
import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';
import MutationAlert from '#/shared/ui/MutationAlert.vue';

import { useLegalApi } from './api';

type Dialog =
  | { kind: 'create' }
  | { kind: 'delete' | 'edit'; variable: Variable };
type Command =
  | { content: CreateVariable; kind: 'create' }
  | { content: VariableContent; key: string; kind: 'update'; revision: number }
  | { key: string; kind: 'delete'; revision: number };

const { t } = useI18n();
const api = useLegalApi();
const format = useFormat();
const id = useId();
const emptyForm = { key: '', description: '', value: '' };
const inputClass =
  'ant-input w-full rounded-md border px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50';
const form = reactive({ ...emptyForm });
const dialog = shallowRef<Dialog>();
const denied = ref('');
const validated = ref(false);
const outcome = ref<'' | 'deleted' | 'saved'>('');
const outcomeHeading = ref<HTMLElement>();
const impactKey = ref('');

function deny(error: ApiError): void {
  denied.value = error.status === 401 ? 'unauthenticated' : 'forbidden';
  variables.clear();
  impact.clear();
  impactKey.value = '';
  outcome.value = '';
  resetDialog();
}

const variables = usePaged<Variable>(
  async (cursor, signal) => {
    const page = await api.listVariables(Number(cursor), signal);
    return { items: page.items, next: String(page.next_offset ?? '') };
  },
  { onDenied: deny },
);

const impactBatchSize = 5;
const impact = usePaged<AdminDocumentMetadata>(
  async (cursor, signal) => {
    const key = impactKey.value;
    const items: AdminDocumentMetadata[] = [];
    let offset = Number(cursor);
    for (let index = 0; index < impactBatchSize; index++) {
      const page = await api.listDocuments(offset, signal, 100);
      items.push(
        ...page.items.filter(
          (version) =>
            version.status === 'published' &&
            version.changed_variables.includes(key),
        ),
      );
      if (page.next_offset === undefined) return { items, next: '' };
      if (page.next_offset <= offset) throw new ApiError('incompatible');
      offset = page.next_offset;
    }
    return { items, next: String(offset) };
  },
  { onDenied: deny },
);

function versionKey(version: AdminDocumentMetadata) {
  return `${version.slug}/${version.version}`;
}
const impactVersions = computed(() => [
  ...new Map(
    impact.items.value.map((version) => [versionKey(version), version]),
  ).values(),
]);

const current = computed(() =>
  dialog.value?.kind === 'create' ? undefined : dialog.value?.variable,
);
const latest = useAsync(
  async (signal) => {
    if (!current.value) throw new ApiError('not_found');
    return api.getVariable(current.value.key, signal);
  },
  { onDenied: deny },
);
const write = useMutation({ onDenied: deny });

const locked = computed(() => write.busy.value || write.uncertain.value);
const listBusy = computed(() => variables.status.value === 'loading');
const dirty = computed(() => {
  if (!dialog.value || dialog.value.kind === 'delete') return false;
  const baseline = current.value ?? emptyForm;
  return (
    form.key !== baseline.key ||
    form.description !== baseline.description ||
    form.value !== baseline.value
  );
});
const canSubmit = computed(
  () =>
    !locked.value &&
    (latest.status.value === 'idle' || latest.status.value === 'ready'),
);
const dialogTitles = {
  create: 'page.legal.variables.newVariable',
  delete: 'page.legal.variables.deleteVariable',
  edit: 'page.legal.variables.editVariable',
};
const dialogTitle = computed(() =>
  t(dialogTitles[dialog.value?.kind ?? 'edit']),
);

useLeaveGuard(() => {
  if (write.uncertain.value) return t('page.common.leaveUncertain');
  return dirty.value || write.busy.value ? t('page.common.leaveUnsaved') : '';
});

function loadVariables() {
  if (locked.value) return;
  denied.value = '';
  return variables.reload();
}
onMounted(loadVariables);

function resetDialog() {
  dialog.value = undefined;
  Object.assign(form, emptyForm);
  latest.clear();
  validated.value = false;
}
onScopeDispose(resetDialog);

function open(next: Dialog) {
  if (locked.value || denied.value || listBusy.value || dialog.value) return;
  resetDialog();
  write.dismiss();
  dialog.value = next;
  if (next.kind !== 'create') {
    const { key, description, value } = next.variable;
    Object.assign(form, { key, description, value });
  }
}

function close() {
  if (
    locked.value ||
    (dirty.value && !window.confirm(t('page.common.leaveUnsaved')))
  )
    return;
  resetDialog();
}

const encoder = new TextEncoder();
function boundedText(value: string, maxBytes: number) {
  return (
    value.length <= maxBytes &&
    !value.includes('\0') &&
    encoder.encode(value).length <= maxBytes
  );
}
const errors = computed(() => ({
  key:
    !/^[a-z][a-z0-9_]{0,63}$/.test(form.key) ||
    ['document_version', 'effective_date'].includes(form.key),
  description: !form.description.trim() || !boundedText(form.description, 512),
  value: !boundedText(form.value, 4096),
}));
const duplicateKey = computed(
  () =>
    dialog.value?.kind === 'create' && write.error.value === 'already_exists',
);
const keyError = computed(() => {
  if (duplicateKey.value) return 'page.legal.variables.alreadyExists';
  return validated.value && errors.value.key
    ? 'page.legal.variables.invalidKey'
    : '';
});
const visibleErrors = computed(() => ({
  description: validated.value && errors.value.description,
  value: validated.value && errors.value.value,
}));

function commandFor(state: Dialog): Command | undefined {
  if (state.kind === 'delete')
    return {
      kind: 'delete',
      key: state.variable.key,
      revision: state.variable.revision,
    };
  validated.value = true;
  if (Object.values(errors.value).some(Boolean)) return undefined;
  const content = { description: form.description, value: form.value };
  if (state.kind === 'create')
    return { kind: 'create', content: { key: form.key, ...content } };
  return {
    kind: 'update',
    content,
    key: state.variable.key,
    revision: state.variable.revision,
  };
}

async function send(command: Command, key: string) {
  if (command.kind === 'create') {
    await api.createVariable(command.content, key);
    return command.content.key;
  }
  await (command.kind === 'update'
    ? api.updateVariable(command.key, command.revision, command.content, key)
    : api.deleteVariable(command.key, command.revision, key));
  return command.key;
}

async function readLatest() {
  write.dismiss();
  await latest.reload();
  if (dialog.value && dialog.value.kind !== 'create' && latest.data.value)
    dialog.value = { ...dialog.value, variable: latest.data.value };
}

async function finish(result: unknown) {
  const state = dialog.value;
  if (!state || denied.value) return;
  if (typeof result === 'string') {
    outcome.value = state.kind === 'delete' ? 'deleted' : 'saved';
    impactKey.value = result;
    resetDialog();
    void loadVariables();
    void impact.reload();
    await nextTick();
    outcomeHeading.value?.focus();
  } else if (
    state.kind !== 'create' &&
    ['conflict', 'not_found'].includes(write.error.value)
  ) {
    await readLatest();
  }
}

async function submit() {
  if (!dialog.value || !canSubmit.value) return;
  const command = commandFor(dialog.value);
  if (!command) {
    const field = (['key', 'description', 'value'] as const).find(
      (name) => errors.value[name],
    );
    if (field)
      document
        .querySelector<HTMLElement>(`#${CSS.escape(`${id}-${field}`)}`)
        ?.focus();
    return;
  }
  await finish(await write.run(command.kind, command, send));
}

function retryList() {
  if (locked.value || dialog.value) return;
  return variables.next.value ? variables.loadMore() : loadVariables();
}

function retryImpact() {
  if (locked.value || dialog.value) return;
  return impact.next.value ? impact.loadMore() : impact.reload();
}

function refresh() {
  if (locked.value || dialog.value) return;
  void loadVariables();
  if (impactKey.value) void impact.reload();
}

async function retryOriginal() {
  if (write.uncertain.value) await finish(await write.retry());
}
</script>

<template>
  <AdminPage
    :title="t('page.legal.variables.title')"
    :description="t('page.legal.variables.intro')"
  >
    <template #extra>
      <div
        v-if="!denied && variables.status.value === 'ready'"
        class="flex flex-wrap gap-2"
      >
        <Button :disabled="!!dialog || locked" @click="refresh">
          {{ t('page.common.refresh') }}
        </Button>
        <Button
          type="primary"
          :disabled="!!dialog || locked"
          @click="open({ kind: 'create' })"
        >
          {{ t('page.legal.variables.newVariable') }}
        </Button>
      </div>
    </template>

    <div class="flex flex-col gap-4">
      <Card v-if="impactKey && !denied" :bordered="false">
        <h2 ref="outcomeHeading" class="mb-2 font-semibold" tabindex="-1">
          {{ t('page.legal.variables.impactedTitle') }}
        </h2>
        <Alert
          v-if="outcome"
          class="mb-3"
          show-icon
          type="success"
          role="status"
          :message="
            t(
              outcome === 'deleted'
                ? 'page.legal.variables.deleted'
                : 'page.common.saved',
            )
          "
        />
        <p class="text-muted-foreground mb-3">
          {{
            t('page.legal.variables.impactedDescription', { key: impactKey })
          }}
        </p>
        <LoadState
          v-if="impact.status.value !== 'ready'"
          :status="impact.status.value"
          :error="impact.error.value"
          @retry="retryImpact"
        />
        <p
          v-if="
            impact.status.value === 'ready' &&
            !impact.next.value &&
            impactVersions.length === 0
          "
        >
          {{ t('page.legal.variables.noImpact') }}
        </p>
        <ul v-if="impactVersions.length > 0" class="divide-border divide-y">
          <li
            v-for="version in impactVersions"
            :key="versionKey(version)"
            class="py-2 [overflow-wrap:anywhere]"
          >
            <bdi>{{
              t('page.legal.variables.documentVersion', {
                title: version.title,
                slug: version.slug,
                version: version.version,
              })
            }}</bdi>
          </li>
        </ul>
        <template v-if="impact.next.value">
          <p class="text-muted-foreground mb-2 mt-3">
            {{ t('page.legal.variables.impactPartial') }}
          </p>
          <Button
            v-if="impact.status.value !== 'error'"
            :disabled="!!dialog || locked || impact.status.value === 'loading'"
            :loading="impact.appending.value"
            @click="impact.loadMore"
          >
            {{ t('page.legal.variables.continueImpact') }}
          </Button>
        </template>
      </Card>

      <Card :bordered="false">
        <LoadState
          v-if="denied || variables.status.value !== 'ready'"
          :status="denied ? 'error' : variables.status.value"
          :error="denied || variables.error.value"
          @retry="retryList"
        />
        <LoadState
          v-else-if="variables.items.value.length === 0"
          status="ready"
          empty
        />
        <ul
          v-if="!denied && variables.items.value.length > 0"
          class="divide-border divide-y"
        >
          <li
            v-for="variable in variables.items.value"
            :key="variable.key"
            class="py-3 first:pt-0"
          >
            <article
              class="flex flex-wrap items-start justify-between gap-3"
              :aria-label="variable.key"
            >
              <div class="min-w-0 flex-1 basis-64 [overflow-wrap:anywhere]">
                <h2 class="font-mono font-semibold">
                  <bdi>{{ variable.key }}</bdi>
                </h2>
                <p dir="auto" class="text-muted-foreground whitespace-pre-wrap">
                  {{ variable.description }}
                </p>
                <p dir="auto" class="mt-1 whitespace-pre-wrap">
                  {{ variable.value || t('page.common.notProvided') }}
                </p>
              </div>
              <div class="flex max-w-full flex-wrap gap-2">
                <Button
                  :disabled="!!dialog || locked || listBusy"
                  @click="open({ kind: 'edit', variable })"
                >
                  {{ t('page.common.edit') }}
                </Button>
                <Button
                  danger
                  :disabled="!!dialog || locked || listBusy"
                  @click="open({ kind: 'delete', variable })"
                >
                  {{ t('page.legal.variables.deleteVariable') }}
                </Button>
              </div>
            </article>
          </li>
        </ul>
        <Button
          v-if="
            variables.next.value &&
            !denied &&
            variables.status.value !== 'error'
          "
          class="mt-3"
          :disabled="!!dialog || locked || listBusy"
          :loading="variables.appending.value"
          @click="variables.loadMore"
        >
          {{ t('page.common.loadMore') }}
        </Button>
      </Card>
    </div>

    <Modal
      :open="!!dialog"
      :closable="!locked"
      :keyboard="!locked"
      :mask-closable="false"
      :title="dialogTitle"
      :footer="null"
      destroy-on-close
      @cancel="close"
    >
      <form
        v-if="dialog"
        class="flex flex-col gap-4"
        novalidate
        @submit.prevent="submit"
      >
        <template v-if="dialog.kind === 'delete'">
          <p class="[overflow-wrap:anywhere]">
            {{
              t('page.legal.variables.deleteConfirm', {
                key: dialog.variable.key,
              })
            }}
          </p>
        </template>
        <template v-else>
          <div>
            <label :for="`${id}-key`" class="mb-1 block font-medium">{{
              t('page.legal.variables.key')
            }}</label>
            <input
              :id="`${id}-key`"
              v-model="form.key"
              :class="inputClass"
              :disabled="locked"
              :readonly="dialog.kind === 'edit'"
              :aria-describedby="
                dialog.kind === 'create' ? `${id}-key-help` : undefined
              "
              :aria-invalid="!!keyError"
              required
              type="text"
              autocomplete="off"
              autocapitalize="off"
              dir="ltr"
              :spellcheck="false"
              @input="duplicateKey && write.dismiss()"
            />
            <p
              v-if="dialog.kind === 'create'"
              :id="`${id}-key-help`"
              :role="keyError ? 'alert' : undefined"
              class="mt-1 text-sm"
              :class="{ 'text-destructive': keyError }"
            >
              {{ t(keyError || 'page.legal.variables.keyHint') }}
            </p>
          </div>
          <div>
            <label :for="`${id}-description`" class="mb-1 block font-medium">{{
              t('page.legal.variables.description')
            }}</label>
            <textarea
              :id="`${id}-description`"
              v-model="form.description"
              class="resize-y"
              :class="inputClass"
              :disabled="locked"
              :aria-describedby="
                visibleErrors.description
                  ? `${id}-description-error`
                  : undefined
              "
              :aria-invalid="visibleErrors.description"
              required
              rows="2"
              dir="auto"
            ></textarea>
            <p
              v-if="visibleErrors.description"
              :id="`${id}-description-error`"
              role="alert"
              class="text-destructive mt-1 text-sm"
            >
              {{ t('page.legal.variables.invalidDescription') }}
            </p>
          </div>
          <div>
            <label :for="`${id}-value`" class="mb-1 block font-medium">{{
              t('page.legal.variables.value')
            }}</label>
            <textarea
              :id="`${id}-value`"
              v-model="form.value"
              class="resize-y"
              :class="inputClass"
              :disabled="locked"
              :aria-describedby="`${id}-value-help`"
              :aria-invalid="visibleErrors.value"
              rows="3"
              dir="auto"
            ></textarea>
            <p
              :id="`${id}-value-help`"
              :role="visibleErrors.value ? 'alert' : undefined"
              class="mt-1 text-sm"
              :class="{ 'text-destructive': visibleErrors.value }"
            >
              {{
                t(
                  visibleErrors.value
                    ? 'page.legal.variables.invalidValue'
                    : 'page.legal.variables.valueHint',
                )
              }}
            </p>
          </div>
        </template>

        <Alert
          v-if="latest.status.value === 'ready' && latest.data.value"
          show-icon
          type="info"
          :message="t('page.common.compareNotice')"
        >
          <template #description>
            <p>
              {{
                t('page.common.revisionValue', {
                  value: format.number(latest.data.value.revision),
                })
              }}
            </p>
            <p dir="auto" class="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {{ latest.data.value.description }}
            </p>
            <p class="mt-2 font-medium">
              {{ t('page.legal.variables.currentOnServer') }}
            </p>
            <p dir="auto" class="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {{ latest.data.value.value || t('page.common.notProvided') }}
            </p>
          </template>
        </Alert>
        <Alert
          v-else-if="latest.error.value === 'not_found'"
          show-icon
          type="warning"
          role="alert"
          :message="t('page.legal.variables.missingOnServer')"
        />
        <LoadState
          v-else-if="latest.status.value !== 'idle'"
          :status="latest.status.value"
          :error="latest.error.value"
          @retry="!locked && readLatest()"
        />
        <MutationAlert
          :busy="write.busy.value"
          :error="duplicateKey ? '' : write.error.value"
          :uncertain="write.uncertain.value"
          @retry="retryOriginal"
        />

        <div class="flex flex-wrap gap-2">
          <Button
            type="primary"
            html-type="submit"
            :loading="write.busy.value"
            :danger="dialog.kind === 'delete'"
            :disabled="!canSubmit"
          >
            {{
              t(
                dialog.kind === 'delete'
                  ? 'page.legal.variables.deleteVariable'
                  : 'page.common.save',
              )
            }}
          </Button>
          <Button :disabled="locked" @click="close">
            {{ t('page.common.cancel') }}
          </Button>
        </div>
      </form>
    </Modal>
  </AdminPage>
</template>
