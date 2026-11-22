<script setup lang="ts">
import { ref, watch } from 'vue';

import { useSession } from '#/shared/session';

const session = useSession();
const generation = ref(0);

// Drop private drafts, pending writes and in-flight reads together when the
// session changes. The new page obtains its own authorization from the server.
watch(
  [
    () => session.authenticatedSession.value?.csrf_token,
    () => session.session.value?.administrator,
  ],
  ([token, administrator], [previous, wasAdmin]) => {
    if (previous && (previous !== token || wasAdmin !== administrator)) generation.value++;
  },
  { flush: 'sync' },
);
</script>

<template>
  <RouterView :key="generation" />
</template>
