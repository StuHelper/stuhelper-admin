<script setup lang="ts">
import { ref, watch } from 'vue';

import { useI18n } from '@vben/locales';

import { snapshot } from './api';
import { type Category, name, type Schema, segment } from './api';
import NamesInput from './NamesInput.vue';
import StatusBlock from './StatusBlock.vue';
import { useResources } from './useResources';
const props = defineProps<{ category?: Category }>();
const emit = defineEmits<{ pending: [value: boolean]; saved: [] }>();
const { t, locale } = useI18n();
const id = ref('');
const value = ref<Schema['CategoryWrite']>({
  revision: 0,
  names: {},
  enabled: true,
  order: 0,
  fields: [],
  group_by: '',
});
const state = useResources();
const { busy, error, uncertain } = state;
watch(
  () => props.category,
  (c) => {
    id.value = c?.id ?? '';
    value.value = c
      ? snapshot(c)
      : {
          revision: 0,
          names: {},
          enabled: true,
          order: 0,
          fields: [],
          group_by: '',
        };
    if ('id' in value.value) delete value.value.id;
  },
  { immediate: true },
);
watch([busy, uncertain], () => emit('pending', busy.value || uncertain.value));
function add() {
  value.value.fields.push({
    key: '',
    names: {},
    kind: 'text',
    required: false,
    filterable: false,
    groupable: false,
    max_length: 200,
  });
}
function mode(index: number) {
  const f = value.value.fields[index];
  if (!f) return;
  delete f.min;
  delete f.max;
  delete f.options;
  delete f.max_length;
  if (f.kind === 'text') f.max_length = 200;
  if (f.kind === 'choice') f.options = [{ id: '', names: {} }];
}
function remove(index: number) {
  const f = value.value.fields[index];
  if (f?.key === value.value.group_by) value.value.group_by = '';
  value.value.fields.splice(index, 1);
}
async function save() {
  await state.run(async () => {
    const payload = snapshot(value.value);
    for (const field of payload.fields) {
      if (typeof field.min !== 'number') delete field.min;
      if (typeof field.max !== 'number') delete field.max;
    }
    if (!payload.fields.some(field => field.key === payload.group_by && field.groupable)) payload.group_by = '';
    const result = await state.mutation.run(
      '/categories/' + segment(id.value),
      'Category',
      payload,
      'PUT',
    );
    value.value.revision = result.revision;
    emit('saved');
  });
}
</script>
<template>
  <form class="resource-form" @submit.prevent="save">
    <StatusBlock :busy="busy" :error="error" @retry="state.retry" />
    <fieldset :disabled="busy || uncertain">
      <legend>{{ t('page.resources.taxonomy') }}</legend>
      <div class="resource-grid">
        <label class="resource-field">{{ t('page.resources.identifier')
          }}<input
            v-model="id"
            required
            maxlength="128"
            pattern="[A-Za-z0-9_-]+"
            :readonly="!!category"
/></label><label class="resource-field">{{ t('page.resources.order')
          }}<input
            v-model.number="value.order"
            type="number"
            required
            min="-100000"
            max="100000"
/></label><label class="resource-inline"><input v-model="value.enabled" type="checkbox" />{{
            t('page.resources.enabled')
          }}</label>
      </div>
      <NamesInput v-model="value.names" />
      <h3>{{ t('page.resources.fields') }}</h3>
      <section
        v-for="(field, index) in value.fields"
        :key="index"
        class="resource-card resource-form"
      >
        <div class="resource-grid">
          <label class="resource-field">{{ t('page.resources.identifier')
            }}<input
              v-model="field.key"
              required
              maxlength="64"
              pattern="[a-z][a-z0-9_-]*"
/></label><label class="resource-field">{{ t('page.resources.fieldKind')
            }}<select v-model="field.kind" @change="mode(index)">
              <option
                v-for="kind in ['text', 'integer', 'choice']"
                :key="kind"
                :value="kind"
              >
                {{ t(`page.resources.${kind}`) }}
              </option>
            </select></label>
        </div>
        <NamesInput v-model="field.names" />
        <div class="resource-actions">
          <label class="resource-inline"><input v-model="field.required" type="checkbox" />{{
              t('page.resources.required')
            }}</label><label class="resource-inline"><input v-model="field.filterable" type="checkbox" />{{
              t('page.resources.filterable')
            }}</label><label class="resource-inline"><input v-model="field.groupable" type="checkbox" />{{
              t('page.resources.groupable')
            }}</label>
        </div>
        <div v-if="field.kind === 'integer'" class="resource-grid">
          <label class="resource-field">{{ t('page.resources.min')
            }}<input
              v-model.number="field.min"
              type="number"
              min="-1000000000"
              max="1000000000"
/></label><label class="resource-field">{{ t('page.resources.max')
            }}<input
              v-model.number="field.max"
              type="number"
              min="-1000000000"
              max="1000000000"
          /></label>
        </div>
        <label v-if="field.kind === 'text'" class="resource-field">{{ t('page.resources.maxLength')
          }}<input
            v-model.number="field.max_length"
            type="number"
            required
            min="1"
            max="1000"
        /></label>
        <section v-if="field.kind === 'choice'">
          <h4>{{ t('page.resources.options') }}</h4>
          <div
            v-for="(option, optionIndex) in field.options"
            :key="optionIndex"
            class="resource-card"
          >
            <label class="resource-field">{{ t('page.resources.identifier')
              }}<input v-model="option.id" required maxlength="128" /></label><NamesInput v-model="option.names" /><button
              type="button"
              @click="field.options?.splice(optionIndex, 1)"
            >
              {{ t('page.resources.remove') }}
            </button>
          </div>
          <button
            type="button"
            :disabled="(field.options?.length ?? 0) >= 100"
            @click="field.options?.push({ id: '', names: {} })"
          >
            {{ t('page.resources.addOption') }}
          </button>
        </section>
        <button type="button" @click="remove(index)">
          {{ t('page.resources.remove') }}
        </button>
      </section>
      <button type="button" :disabled="value.fields.length >= 20" @click="add">
        {{ t('page.resources.addField') }}
</button><label class="resource-field">{{ t('page.resources.groupBy')
        }}<select v-model="value.group_by">
          <option value="">{{ t('page.resources.noGrouping') }}</option>
          <option
            v-for="field in value.fields.filter((x) => x.groupable && x.key)"
            :key="field.key"
            :value="field.key"
          >
            {{ name(field.names, locale) || field.key }}
          </option>
        </select></label>
    </fieldset>
    <button type="submit" :disabled="busy">
      {{ t(uncertain ? 'page.resources.retry' : 'page.resources.save') }}
    </button>
  </form>
</template>
