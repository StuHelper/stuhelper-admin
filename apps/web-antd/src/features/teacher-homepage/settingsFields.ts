import type { AllowlistField } from './settingsApi';

import { dynamicFields, selectorKey as fieldKey } from './fieldSelectors';

export { dynamicFields, fieldKey };
export { standardFields } from './fieldSelectors';

export type DynamicField = (typeof dynamicFields)[number];
export const allowlistLimit = 256;
export const labelLimit = 160;

export function sameAllowlist(
  current: readonly AllowlistField[],
  draft: readonly AllowlistField[],
) {
  const keys = new Set(current.map((field) => fieldKey(field)));
  return current.length === draft.length && draft.every((field) => keys.has(fieldKey(field)));
}

/** Apply the administrator's additions and removals to the latest list. */
export function rebaseAllowlist(
  current: readonly AllowlistField[],
  draft: readonly AllowlistField[],
  latest: readonly AllowlistField[],
) {
  const originalKeys = new Set(current.map((field) => fieldKey(field)));
  const draftKeys = new Set(draft.map((field) => fieldKey(field)));
  const latestKeys = new Set(latest.map((field) => fieldKey(field)));
  return [
    ...latest.filter((field) => {
      const key = fieldKey(field);
      return !originalKeys.has(key) || draftKeys.has(key);
    }),
    ...draft.filter((field) => {
      const key = fieldKey(field);
      return !originalKeys.has(key) && !latestKeys.has(key);
    }),
  ];
}
