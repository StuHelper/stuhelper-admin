/**
 * Validate an untrusted external URL before binding it to an anchor `href`.
 * Allows only `https:` and `http:` URLs with a non-empty hostname and without
 * embedded credentials; any other string returns `undefined` so the template
 * renders plain text instead of an executable `javascript:` or `data:` URI.
 */
export function safeExternalUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return undefined;
    }
    if (!parsed.hostname || parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}
