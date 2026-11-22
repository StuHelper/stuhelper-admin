<script setup lang="ts">
import { useI18n } from '@vben/locales';

import AdminPage from '#/shared/ui/AdminPage.vue';

import { useCampusId } from '../academic/campus';
import CampusPending from '../academic/CampusPending.vue';
import { useTeacherHomepageAccess } from './access';
import SettingsSchool from './SettingsSchool.vue';

const { t } = useI18n();
const school = useCampusId();
const { owner } = useTeacherHomepageAccess();
</script>

<template>
  <AdminPage :title="t('page.teacherHomepage.settings.title')">
    <CampusPending v-if="!school" @ready="school = $event" />
    <SettingsSchool v-else :key="`${owner}:${school}`" :school="school" />
  </AdminPage>
</template>
