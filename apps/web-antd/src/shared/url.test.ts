import { describe, expect, it } from 'vitest';

import { safeExternalUrl } from './url';

describe('safeExternalUrl (A-01)', () => {
  it('accepts only http and https URLs without credentials', () => {
    expect(safeExternalUrl('https://www.buaa.edu.cn')).toBe(
      'https://www.buaa.edu.cn/',
    );
    expect(safeExternalUrl('  http://example.edu/path?a=1  ')).toBe(
      'http://example.edu/path?a=1',
    );
    expect(safeExternalUrl('javascript:alert(document.cookie)')).toBeUndefined();
    expect(safeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeExternalUrl('vbscript:msgbox(1)')).toBeUndefined();
    expect(safeExternalUrl('https://user:secret@example.edu/')).toBeUndefined();
    expect(safeExternalUrl('not a url')).toBeUndefined();
    expect(safeExternalUrl('')).toBeUndefined();
  });
});
