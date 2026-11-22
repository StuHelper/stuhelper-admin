<script setup lang="ts">
import { watch } from 'vue';

import { useI18n } from '@vben/locales';

import AdminPage from '#/shared/ui/AdminPage.vue';
import LoadState from '#/shared/ui/LoadState.vue';

import { useCampusId } from '../academic/campus';
import CampusPending from '../academic/CampusPending.vue';
import { useTeacherHomepageAccess } from './access';
import MatchingReview from './MatchingReview.vue';

const { t } = useI18n();
const school = useCampusId();
const access = useTeacherHomepageAccess();

watch(
  [access.owner, school],
  ([owner, id]) => {
    if (owner && id) void access.checkMaintain();
  },
  { immediate: true },
);
</script>

<template>
  <AdminPage
    :title="t('page.teacherHomepage.match.title')"
    :description="t('page.teacherHomepage.match.intro')"
  >
    <CampusPending v-if="!school" @ready="school = $event" />
    <template v-else-if="access.owner.value">
      <LoadState
        v-if="access.maintainError.value"
        class="mb-4"
        status="error"
        :error="access.maintainError.value"
        @retry="access.retryMaintain()"
      />
      <MatchingReview
        :key="`${access.owner.value}:${school}`"
        :school="school"
        :may-write="access.canMaintain.value"
        @read="access.reportRead"
        @write-denied="access.reportMaintain($event, false)"
      />
    </template>
  </AdminPage>
</template>
