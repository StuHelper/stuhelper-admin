<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useI18n } from '@vben/locales';

import { Alert, Button, Card, Empty, Skeleton } from 'ant-design-vue';

import AdminPage from '#/shared/ui/AdminPage.vue';
import { useErrorText } from '#/shared/ui/messages';

import { useCampusId } from '../academic/campus';
import CampusPending from '../academic/CampusPending.vue';
import CatalogObjectSelect from '../academic/CatalogObjectSelect.vue';
import { useTeacherHomepageAccess } from './access';
import ProfileEditor from './ProfileEditor.vue';

const { t } = useI18n();
const errorText = useErrorText();
const route = useRoute();
const router = useRouter();
const school = useCampusId();
const access = useTeacherHomepageAccess();
const teacher = computed(() =>
  typeof route.query.teacher_id === 'string' ? route.query.teacher_id : '',
);
const editorKey = computed(() => JSON.stringify([access.owner.value, school.value, teacher.value]));
const checking = ref(false);

async function checkMaintain(retry = false) {
  checking.value = true;
  try {
    await (retry ? access.retryMaintain() : access.checkMaintain());
  } finally {
    checking.value = false;
  }
}

watch([school, teacher, access.owner], ([schoolId, teacherId]) => {
  if (schoolId && !teacherId) void checkMaintain();
}, { immediate: true });

function selectTeacher(teacherId?: string) {
  void router.push({ query: { ...route.query, teacher_id: teacherId } });
}
</script>

<template>
  <AdminPage :title="t('page.teacherHomepage.profile.title')">
    <div class="flex flex-col gap-4">
      <CampusPending v-if="!school" @ready="school = $event" />
      <template v-else>
        <Card v-if="access.canMaintain.value" :bordered="false">
          <div class="flex max-w-lg flex-col gap-2">
            <label for="teacher-homepage-teacher">
              {{ t('page.teacherHomepage.profile.teacher') }}
            </label>
            <CatalogObjectSelect
              admin
              allow-clear
              input-id="teacher-homepage-teacher"
              kind="teacher"
              :model-value="teacher || undefined"
              :placeholder="t('page.teacherHomepage.profile.chooseTeacher')"
              :school-id="school"
              @update:model-value="selectTeacher"
            />
          </div>
        </Card>
        <ProfileEditor
          v-if="teacher"
          :key="editorKey"
          :school-id="school"
          :teacher-id="teacher"
        />
        <Card v-else-if="access.canMaintain.value" :bordered="false">
          <Empty :description="t('page.teacherHomepage.profile.selectTeacher')" />
        </Card>
        <Skeleton v-else-if="checking" active :paragraph="{ rows: 1 }" />
        <Alert
          v-else
          type="error"
          role="alert"
          show-icon
          :message="errorText(access.maintainError.value || 'forbidden')"
        >
          <template #action>
            <Button size="small" @click="checkMaintain(true)">
              {{ t('page.common.retry') }}
            </Button>
          </template>
        </Alert>
      </template>
    </div>
  </AdminPage>
</template>
