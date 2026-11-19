import { describe, expect, it } from 'vitest';

import { diffText } from './textDiff';

describe('diffText', () => {
  it('marks removed and added words while keeping unchanged context', () => {
    const segments = diffText('讲课节奏偏快，作业很多。', '讲课节奏适中，作业适量。');
    expect(segments).toEqual([
      { kind: 'equal', text: '讲课节奏' },
      { kind: 'removed', text: '偏快' },
      { kind: 'added', text: '适中' },
      { kind: 'equal', text: '，作业' },
      { kind: 'removed', text: '很多' },
      { kind: 'added', text: '适量' },
      { kind: 'equal', text: '。' },
    ]);
  });

  it('handles identical texts and bounded fallback for long bodies', () => {
    expect(diffText('same body', 'same body')).toEqual([
      { kind: 'equal', text: 'same body' },
    ]);
    const longBefore = `${'A '.repeat(400)}old tail`;
    const longAfter = `${'A '.repeat(400)}new tail`;
    const segments = diffText(longBefore, longAfter);
    expect(
      segments.filter((item) => item.kind !== 'removed').map((item) => item.text).join(''),
    ).toBe(longAfter);
    expect(
      segments.filter((item) => item.kind !== 'added').map((item) => item.text).join(''),
    ).toBe(longBefore);
  });
});
