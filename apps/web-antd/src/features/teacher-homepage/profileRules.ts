import type { CatalogSchemas } from './catalog';

import { isGroupField, selectorKey as profileSelectorKey } from './fieldSelectors';

export { isGroupField, profileSelectorKey };
export { profileFields } from './fieldSelectors';

export type ProfileControls = CatalogSchemas['TeacherHomepageControls'];
export type ProfileDraft = CatalogSchemas['TeacherHomepageControlsInput'];
export type ProfileRule = CatalogSchemas['TeacherHomepageFieldRuleInput'];
export type ProfileSelector = ProfileRule['field'];
export type ProfileOverride = NonNullable<ProfileRule['override']>;
export type ProfileField = Exclude<ProfileSelector['field'], 'page'>;
export type ProfileVisibility = ProfileControls['page_visibility'];
export type ProfileSupervisor = CatalogSchemas['TeacherHomepageSupervisor'];

export const profileVisibilities = [
  'visible',
  'hidden',
  'stopped',
] as const satisfies readonly ProfileVisibility[];

export const profileSupervisors = [
  '博士生导师',
  '硕士生导师',
] as const satisfies readonly ProfileSupervisor[];

export const supervisorKeys = {
  博士生导师: 'doctoral',
  硕士生导师: 'masters',
} as const satisfies Record<ProfileSupervisor, string>;

export function profileFieldKey(field: ProfileSelector['field']) {
  return `page.teacherHomepage.fields.${field}`;
}

export function profileValueKind(selector: ProfileSelector) {
  const { field, label } = selector;
  if (
    field === 'photo' ||
    field === 'supervisors' ||
    (isGroupField(field) && !label)
  ) {
    return field;
  }
  return 'text';
}

export function emptyProfileOverride(field: ProfileSelector): ProfileOverride {
  switch (profileValueKind(field)) {
    case 'fields': {
      return { fields: [] };
    }
    case 'photo': {
      return {};
    }
    case 'sections': {
      return { sections: [] };
    }
    case 'supervisors': {
      return { supervisors: [] };
    }
    default: {
      return { text: '' };
    }
  }
}

function textLimit(field: ProfileSelector['field']) {
  switch (field) {
    case 'biography':
    case 'research':
    case 'sections': {
      return 16_000;
    }
    case 'fields': {
      return 1024;
    }
    case 'name': {
      return 256;
    }
    default: {
      return 512;
    }
  }
}

export function validProfileText(value: string, limit: number) {
  return value.trim().length > 0 && [...value].length <= limit;
}

export function validProfileRule({ field, hidden, override }: ProfileRule) {
  if (!override) return hidden;
  switch (profileValueKind(field)) {
    case 'fields': {
      return !!override.fields && override.fields.every(
        (item) => validProfileText(item.label, 160) && validProfileText(item.value, 1024),
      );
    }
    case 'photo': {
      return !!override.photo;
    }
    case 'sections': {
      return !!override.sections && override.sections.every(
        (item) => validProfileText(item.title, 160) && validProfileText(item.text, 16_000),
      );
    }
    case 'supervisors': {
      return !!override.supervisors;
    }
    default: {
      return validProfileText(override.text ?? '', textLimit(field.field));
    }
  }
}

export function draftFromControls(controls: ProfileControls): ProfileDraft {
  return {
    expected_revision: controls.revision,
    page_visibility: controls.page_visibility,
    rules: controls.rules.map(({ field, hidden, override }) => ({
      field,
      hidden,
      ...(override
        ? {
            override: override.photo
              ? { photo: { id: override.photo.id } }
              : override,
          }
        : {}),
    })),
  };
}

function equivalent(left: unknown, right: unknown) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function profileDraftChanged(before: ProfileDraft, after: ProfileDraft) {
  return (
    before.expected_revision !== after.expected_revision ||
    before.page_visibility !== after.page_visibility ||
    before.rules.length !== after.rules.length ||
    before.rules.some((rule, index) => !equivalent(rule, after.rules[index]))
  );
}

/** Carry forward draft edits that do not overwrite concurrently changed rules. */
export function mergeProfileDraft(
  before: ProfileDraft,
  local: ProfileDraft,
  current: ProfileDraft,
) {
  let overlapping = false;
  function choose<T>(previous: T, edited: T, latest: T): T {
    if (equivalent(previous, edited)) return latest;
    if (equivalent(previous, latest)) return edited;
    if (!equivalent(edited, latest)) overlapping = true;
    return latest;
  }

  const byField = (rules: ProfileRule[]) =>
    new Map(rules.map((rule) => [profileSelectorKey(rule.field), rule]));
  const baseRules = byField(before.rules);
  const localRules = byField(local.rules);
  const currentRules = byField(current.rules);
  const keys = new Set([...currentRules.keys(), ...localRules.keys()]);
  const rules: ProfileRule[] = [];
  for (const key of keys) {
    const rule = choose(baseRules.get(key), localRules.get(key), currentRules.get(key));
    if (rule) rules.push(rule);
  }

  const draft: ProfileDraft = {
    expected_revision: current.expected_revision,
    page_visibility: choose(
      before.page_visibility,
      local.page_visibility,
      current.page_visibility,
    ),
    rules,
  };
  return { draft, overlapping };
}
