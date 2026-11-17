export interface DiffSegment {
  kind: 'added' | 'equal' | 'removed';
  text: string;
}

const tokenPattern =
  /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;

function tokenize(text: string): string[] {
  return text.match(tokenPattern) ?? [];
}

function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const last = merged.at(-1);
    if (last && last.kind === segment.kind) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function lcsDiff(before: string[], after: string[]): DiffSegment[] {
  const m = before.length;
  const n = after.length;
  const width = n + 1;
  const table = new Int32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? (table[(i + 1) * width + (j + 1)] ?? 0) + 1
          : Math.max(
              table[(i + 1) * width + j] ?? 0,
              table[i * width + (j + 1)] ?? 0,
            );
    }
  }
  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (before[i] === after[j]) {
      out.push({ kind: 'equal', text: before[i] ?? '' });
      i++;
      j++;
    } else if (
      (table[(i + 1) * width + j] ?? 0) >= (table[i * width + (j + 1)] ?? 0)
    ) {
      out.push({ kind: 'removed', text: before[i] ?? '' });
      i++;
    } else {
      out.push({ kind: 'added', text: after[j] ?? '' });
      j++;
    }
  }
  while (i < m) out.push({ kind: 'removed', text: before[i++] ?? '' });
  while (j < n) out.push({ kind: 'added', text: after[j++] ?? '' });
  return mergeSegments(out);
}

function prefixSuffixDiff(before: string[], after: string[]): DiffSegment[] {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  return mergeSegments([
    { kind: 'equal', text: before.slice(0, start).join('') },
    { kind: 'removed', text: before.slice(start, endBefore).join('') },
    { kind: 'added', text: after.slice(start, endAfter).join('') },
    { kind: 'equal', text: before.slice(endBefore).join('') },
  ]);
}

/**
 * Compute inline diff segments between an existing review body and a proposed
 * or historical body. Token-level LCS is bounded so 16k-character reviews fall
 * back to line or prefix/suffix comparison without blocking the main thread.
 */
export function diffText(before: string, after: string): DiffSegment[] {
  if (before === after) {
    return before ? [{ kind: 'equal', text: before }] : [];
  }
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);
  if (beforeTokens.length * afterTokens.length <= 90_000) {
    return lcsDiff(beforeTokens, afterTokens);
  }
  const beforeLines = before.split(/(\n)/);
  const afterLines = after.split(/(\n)/);
  if (beforeLines.length * afterLines.length <= 90_000) {
    return lcsDiff(beforeLines, afterLines);
  }
  return prefixSuffixDiff(beforeLines, afterLines);
}
