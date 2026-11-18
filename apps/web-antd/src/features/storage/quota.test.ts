import { describe, expect, it } from 'vitest';

import {
  defaultQuotaUnit,
  formatQuotaPlaceholder,
  parseQuotaBytes,
} from './quota';

describe('storage quota conversion', () => {
  it('converts decimal GB, TB and B values into exact safe-integer bytes', () => {
    expect(parseQuotaBytes('500', 'GB')).toBe(500_000_000_000);
    expect(parseQuotaBytes('1.5', 'TB')).toBe(1_500_000_000_000);
    expect(parseQuotaBytes('0.125', 'GB')).toBe(125_000_000);
    expect(parseQuotaBytes('2048', 'B')).toBe(2048);
    expect(parseQuotaBytes('1.5', 'B')).toBeUndefined();
    expect(parseQuotaBytes('99999', 'TB')).toBeUndefined();
  });

  it('chooses sensible default units and lossless placeholders', () => {
    expect(defaultQuotaUnit(0)).toBe('GB');
    expect(defaultQuotaUnit(1024)).toBe('B');
    expect(defaultQuotaUnit(500_000_000_000)).toBe('GB');
    expect(defaultQuotaUnit(2_000_000_000_000)).toBe('TB');
    expect(formatQuotaPlaceholder(500_000_000_000, 'GB')).toBe('500');
    expect(formatQuotaPlaceholder(1_500_000_000_000, 'TB')).toBe('1.5');
    expect(formatQuotaPlaceholder(1024, 'B')).toBe('1024');
  });
});
