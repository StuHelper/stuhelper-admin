import type { ProfileControls, ProfileDraft } from './profileRules';

import { describe, expect, it } from 'vitest';

import {
  draftFromControls,
  mergeProfileDraft,
  profileSelectorKey,
  validProfileRule,
} from './profileRules';

describe('teacher homepage profile rules', () => {
  it('sends only the saved portrait ID when retaining a replacement', () => {
    const id = 'a'.repeat(64);
    const controls: ProfileControls = {
      independent: true,
      page_visibility: 'stopped',
      revision: 7,
      rules: [{
        field: { field: 'photo' },
        hidden: true,
        override: { photo: { content_type: 'image/png', width: 120, height: 168, id } },
      }],
    };

    expect(draftFromControls(controls)).toEqual({
      expected_revision: 7,
      page_visibility: 'stopped',
      rules: [{ field: { field: 'photo' }, hidden: true, override: { photo: { id } } }],
    });
  });

  it('preserves independent edits on conflict and adopts concurrent values for overlapping edits', () => {
    const before: ProfileDraft = {
      expected_revision: 3,
      page_visibility: 'visible',
      rules: [{
        field: { field: 'email' },
        hidden: true,
      }, {
        field: { field: 'fields', label: 'Research group' },
        hidden: true,
      }],
    };
    const local: ProfileDraft = {
      ...before,
      page_visibility: 'hidden',
      rules: [{
        field: { field: 'email' },
        hidden: true,
        override: { text: 'local@example.org' },
      }, {
        field: { field: 'photo' },
        hidden: false,
        override: { photo: { content_type: 'image/png', data: 'YQ==' } },
      }],
    };
    const current: ProfileDraft = {
      ...before,
      expected_revision: 4,
      page_visibility: 'stopped',
      rules: [{
        field: { field: 'email' },
        hidden: false,
        override: { text: 'remote@example.org' },
      }, before.rules[1]!, {
        field: { field: 'phone' },
        hidden: true,
      }],
    };
    const { draft, overlapping } = mergeProfileDraft(before, local, current);
    expect(overlapping).toBe(true);
    expect(draft).toEqual({
      expected_revision: 4,
      page_visibility: 'stopped',
      rules: [current.rules[0], current.rules[2], local.rules[1]],
    });
  });

  it('accepts empty group replacements and requires a valid value for other replacements', () => {
    expect(validProfileRule({
      field: { field: 'sections' },
      hidden: false,
      override: { sections: [] },
    })).toBe(true);
    expect(validProfileRule({
      field: { field: 'photo' },
      hidden: true,
      override: {},
    })).toBe(false);
    expect(validProfileRule({
      field: { field: 'name' },
      hidden: false,
      override: { text: '𠮷'.repeat(256) },
    })).toBe(true);
    expect(validProfileRule({
      field: { field: 'name' },
      hidden: true,
      override: { text: ' ' },
    })).toBe(false);
    expect(profileSelectorKey({ field: 'fields', label: 'Ｒｅｓｅａｒｃｈ　 group：' }))
      .toBe(profileSelectorKey({ field: 'fields', label: 'research group' }));
  });
});
