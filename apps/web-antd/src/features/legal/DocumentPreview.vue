<script setup lang="ts">
import { computed } from 'vue';

import { useI18n } from '@vben/locales';

const props = defineProps<{ digest: string; html: string }>();
const { t } = useI18n();

// The frame has an opaque origin and cannot run scripts, open popups, submit
// forms, or load external resources. Keep the rendered fragment out of the app DOM.
const srcdoc = computed(() => `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>
  :root { color-scheme: light dark; }
  body { color: CanvasText; background: Canvas; margin: 0; padding: 1rem; font: 1rem/1.6 system-ui, sans-serif; overflow-wrap: anywhere; }
  h1, h2, h3 { line-height: 1.35; }
  h1 { font-size: 1.5rem; }
  table { border-collapse: collapse; max-inline-size: 100%; }
  th, td { padding: .375rem; border: 1px solid GrayText; text-align: start; }
  pre { white-space: pre-wrap; }
</style>
<body dir="auto">${props.html}</body>`);
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <iframe
      class="w-full rounded border"
      style="height: min(55vh, 32rem)"
      sandbox=""
      referrerpolicy="no-referrer"
      :srcdoc="srcdoc"
      :title="t('page.legal.documents.previewFrame')"
    ></iframe>
    <div class="min-w-0">
      <div class="text-sm font-medium">{{ t('page.legal.documents.previewDigest') }}</div>
      <code class="block break-all text-xs" dir="ltr">{{ digest }}</code>
    </div>
  </div>
</template>
