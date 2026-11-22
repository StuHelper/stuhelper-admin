import type { CatalogSchemas } from './catalog';

type FieldSelector = CatalogSchemas['TeacherHomepageFieldSelector'];
type HomepageField = Exclude<FieldSelector['field'], 'page'>;

const fixedTextAndSupervisorFields = [
  'name',
  'position',
  'education',
  'degree',
  'discipline',
  'supervisors',
  'email',
  'phone',
  'office_location',
  'hire_date',
  'biography',
  'research',
] as const satisfies readonly HomepageField[];

export const dynamicFields = ['fields', 'sections'] as const satisfies readonly HomepageField[];
export const standardFields = [...fixedTextAndSupervisorFields, 'photo'] as const;
export const profileFields = [...fixedTextAndSupervisorFields, ...dynamicFields, 'photo'] as const;

export function isGroupField(field: FieldSelector['field']): field is (typeof dynamicFields)[number] {
  return field === 'fields' || field === 'sections';
}

export function selectorKey({ field, label = '' }: FieldSelector) {
  // The provider validates and case folds the selector. The editor also
  // recognizes common spelling variations while editing and merging changes.
  const normalized = label
    .normalize('NFKC')
    .trim()
    .replace(/:+$/u, '')
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .toLowerCase();
  return `${field}:${normalized}`;
}
