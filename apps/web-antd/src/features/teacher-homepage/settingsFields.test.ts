import type { AllowlistField } from './settingsApi';

import { expect, it } from 'vitest';

import { fieldKey, rebaseAllowlist, sameAllowlist } from './settingsFields';

it('compares matching field labels without mixing additional fields and sections', () => {
  expect(fieldKey({ field: 'fields', label: ' Ｒｅｓｅａｒｃｈ　topics： ' })).toBe(
    fieldKey({ field: 'fields', label: 'research topics' }),
  );
  expect(fieldKey({ field: 'fields', label: 'research topics' })).not.toBe(
    fieldKey({ field: 'sections', label: 'research topics' }),
  );
});

it('rebases allowlist additions and removals against the latest school revision', () => {
  const current: AllowlistField[] = [
    { field: 'email' },
    { field: 'position' },
    { field: 'sections', label: 'Publications' },
  ];
  const draft: AllowlistField[] = [
    { field: 'email' },
    { field: 'position' },
    { field: 'fields', label: 'Research topics' },
  ];
  const latest: AllowlistField[] = [
    { field: 'email' },
    { field: 'sections', label: 'publications:' },
    { field: 'degree' },
  ];

  expect(rebaseAllowlist(current, draft, latest)).toEqual([
    { field: 'email' },
    { field: 'degree' },
    { field: 'fields', label: 'Research topics' },
  ]);
  expect(
    sameAllowlist(
      [{ field: 'email' }, { field: 'sections', label: 'Publications' }],
      [{ field: 'sections', label: 'publications:' }, { field: 'email' }],
    ),
  ).toBe(true);
  expect(
    sameAllowlist([{ field: 'email' }], [{ field: 'phone' }]),
  ).toBe(false);
});
