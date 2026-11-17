<script setup lang="ts">
import type { AccountJumpDestination } from '#/shared/account-jump';

import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useI18n } from '@vben/locales';

import {
  fromIssuerSubject,
  parseAccountIdentifier,
  useAccountJump,
} from '#/shared/account-jump';
import { useCapabilities } from '#/shared/capabilities';

const props = withDefaults(
  defineProps<{
    account?: string;
    issuer?: string;
    subject?: string;
  }>(),
  {
    account: '',
    issuer: undefined,
    subject: undefined,
  },
);

const { t } = useI18n();
const router = useRouter();
const capabilities = useCapabilities();
const accountJump = useAccountJump();
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const target = computed(() =>
  props.issuer !== undefined || props.subject !== undefined
    ? fromIssuerSubject(props.issuer ?? '', props.subject ?? '')
    : parseAccountIdentifier(props.account),
);

const copyText = computed(
  () => target.value.principalKey || target.value.raw || target.value.subject,
);

const destinations = computed(() => {
  const list: {
    key: AccountJumpDestination;
    label: string;
    path: string;
  }[] = [];
  if (
    capabilities.has('billing.manage') &&
    (target.value.issuer || accountJump.recentIssuer.value || target.value.subject)
  ) {
    list.push({
      key: 'billing',
      label: t('page.accountJump.toBilling'),
      path: '/billing/accounts',
    });
  }
  if (capabilities.has('qq-binding.manage')) {
    list.push({
      key: 'qqBinding',
      label: t('page.accountJump.toQqBinding'),
      path: '/qq-binding',
    });
  }
  list.push(
    {
      key: 'roles',
      label: t('page.accountJump.toRoles'),
      path: '/system/roles',
    },
    {
      key: 'sessions',
      label: t('page.accountJump.toSessions'),
      path: '/system/sessions',
    },
  );
  return list;
});

async function copyAccount() {
  if (!copyText.value) return;
  try {
    await navigator.clipboard?.writeText(copyText.value);
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    copied.value = false;
  }
}

function go(destination: AccountJumpDestination, path: string) {
  if (!target.value.subject && !target.value.principalKey) return;
  accountJump.prepare(destination, target.value);
  void router.push(path);
}

onBeforeUnmount(() => {
  clearTimeout(copyTimer);
});
</script>

<template>
  <span
    v-if="copyText"
    class="inline-flex max-w-full flex-wrap items-center gap-1"
  >
    <button
      type="button"
      class="border-border bg-muted/40 hover:bg-muted rounded border px-1.5 py-0.5 text-xs whitespace-normal"
      @click="copyAccount"
    >
      {{ t(copied ? 'page.accountJump.copied' : 'page.accountJump.copyAccount') }}
    </button>
    <button
      v-for="item in destinations"
      :key="item.key"
      type="button"
      class="border-border bg-muted/40 hover:bg-muted text-primary rounded border px-1.5 py-0.5 text-xs whitespace-normal"
      @click="go(item.key, item.path)"
    >
      {{ item.label }}
    </button>
  </span>
</template>
