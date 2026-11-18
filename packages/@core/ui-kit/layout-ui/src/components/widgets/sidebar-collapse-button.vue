<script setup lang="ts">
import { useSimpleLocale } from '@vben-core/composables';
import { ChevronsLeft, ChevronsRight } from '@vben-core/icons';

const collapsed = defineModel<boolean>('collapsed');
const { $t } = useSimpleLocale();

function handleCollapsed() {
  collapsed.value = !collapsed.value;
}
</script>

<template>
  <div
    :aria-label="$t(collapsed ? 'expand' : 'collapse')"
    class="absolute bottom-2 start-3 z-10 flex-center cursor-pointer rounded-sm bg-accent p-1 text-foreground/60 hover:bg-accent-hover hover:text-foreground"
    role="button"
    tabindex="0"
    @click.stop="handleCollapsed"
    @keydown.enter.prevent="handleCollapsed"
    @keydown.space.prevent="handleCollapsed"
  >
    <ChevronsRight v-if="collapsed" class="size-4 rtl:rotate-180" />
    <ChevronsLeft v-else class="size-4 rtl:rotate-180" />
  </div>
</template>
