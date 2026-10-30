import type { CatalogObject } from './api';

import { describe, expect, it } from 'vitest';

import { chooseCampus } from './campus';

const school = (id: string) => ({ id }) as CatalogObject;

describe('served university', () => {
  it('uses the only school record, or the configured one among several', () => {
    expect(chooseCampus([school('a')], undefined).id).toBe('a');
    expect(chooseCampus([school('a'), school('b')], 'b').id).toBe('b');
  });
  it('refuses to guess when the record is missing or ambiguous', () => {
    expect(() => chooseCampus([], undefined)).toThrow();
    expect(() => chooseCampus([school('a'), school('b')], undefined)).toThrow();
    expect(() => chooseCampus([school('a')], 'b')).toThrow();
  });
});
