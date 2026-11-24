import { describe, expect, it } from 'vitest';

import {
  defaultQuotaUnit,
  formatQuotaPlaceholder,
  parseQuotaBytes,
} from './quota';

describe('storage quota conversion', () => {
  it('converts binary GB, TB and B values into exact safe-integer bytes', () => {
    expect(parseQuotaBytes('500', 'GB')).toBe(500 * 2 ** 30);
    expect(parseQuotaBytes('1.5', 'TB')).toBe(1.5 * 2 ** 40);
    expect(parseQuotaBytes('0.125', 'GB')).toBe(2 ** 27);
    expect(parseQuotaBytes('2048', 'B')).toBe(2048);
    expect(parseQuotaBytes('1.5', 'B')).toBeUndefined();
    expect(parseQuotaBytes('99999', 'TB')).toBeUndefined();
  });

  it('chooses sensible default units and lossless placeholders', () => {
    expect(defaultQuotaUnit(0)).toBe('GB');
    expect(defaultQuotaUnit(1024)).toBe('B');
    expect(defaultQuotaUnit(500 * 2 ** 30)).toBe('GB');
    expect(defaultQuotaUnit(2 * 2 ** 40)).toBe('TB');
    expect(formatQuotaPlaceholder(500 * 2 ** 30, 'GB')).toBe('500');
    expect(formatQuotaPlaceholder(1.5 * 2 ** 40, 'TB')).toBe('1.5');
    expect(formatQuotaPlaceholder(1024, 'B')).toBe('1024');
  });
});
