import type { components } from '../api/legal.gen';

type Issue = components['schemas']['ValidationIssue'];
type Draft = components['schemas']['DraftContent'];
type Preview = components['schemas']['Preview'];

const escape = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function inlineMarkdown(source: string) {
  return escape(source)
    .replaceAll(/\u0060([^\u0060\n]+)\u0060|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~/gu, (_, code, bold, strike) => {
      if (code !== undefined) return `<code>${code}</code>`;
      if (bold !== undefined) return `<strong>${bold}</strong>`;
      return `<del>${strike}</del>`;
    });
}

/** The offline demo renders a small Markdown subset. Production uses the API's HTML. */
function markdownFragment(markdown: string) {
  return markdown.trim().split(/\r?\n\s*\r?\n/u).map((block) => {
    const heading = /^(#{1,6})[ \t]+([^\r\n]+)$/u.exec(block);
    if (heading?.[1] && heading[2]) {
      const tag = `h${heading[1].length}`;
      return `<${tag}>${inlineMarkdown(heading[2])}</${tag}>`;
    }
    const lines = block.split(/\r?\n/u);
    if (lines.every((line) => /^[-*][ \t]+/u.test(line))) {
      return `<ul>${lines.map((line) => `<li>${inlineMarkdown(line.replace(/^[-*][ \t]+/u, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${inlineMarkdown(block)}</p>`;
  }).join('\n');
}

export async function renderLegalDemo(
  draft: Pick<Draft, 'markdown' | 'title'>,
  version: string,
  effectiveDate: string,
  variables: ReadonlyMap<string, { value: string }>,
): Promise<(Preview & { variables: ReadonlyMap<string, string> }) | { issues: Issue[] }> {
  const placeholder = /\{\{([a-z][a-z0-9_]{0,63})\}\}/gu;
  const sources = [draft.title, draft.markdown];
  if (sources.some((value) => /\{\{|\}\}/u.test(value.replaceAll(placeholder, '')))) {
    return { issues: [{ code: 'malformed_variable' }] };
  }
  if (/<(?:\/?[a-z][\w-]*(?:\s[^>]*)?\/?|![^>]*|\?[^>]*)>/iu.test(draft.markdown)) {
    return { issues: [{ code: 'raw_html' }] };
  }
  if (/!\[[^\]]*\]\(/u.test(draft.markdown)) {
    return { issues: [{ code: 'unsupported_markdown' }] };
  }
  if (/\]\(\s*(?:javascript|data|http):/iu.test(draft.markdown)) {
    return { issues: [{ code: 'unsafe_link' }] };
  }

  const keys = new Set(sources.flatMap((value) =>
    [...value.matchAll(placeholder)].map((match) => match[1]!),
  ));
  if (keys.size > 256) return { issues: [{ code: 'too_many_variables' }] };

  const resolved = new Map<string, string>();
  const snapshot = new Map<string, string>();
  const issues: Issue[] = [];
  for (const key of keys) {
    const stored = variables.get(key)?.value;
    const value = key === 'document_version' ? version : (key === 'effective_date' ? effectiveDate : stored);
    if (value === undefined) issues.push({ code: 'undefined_variable', key });
    else if (value.trim() === '') issues.push({ code: 'empty_variable', key });
    else {
      resolved.set(key, value);
      if (stored !== undefined) snapshot.set(key, stored);
    }
  }
  if (issues.length > 0) return { issues };

  const title = draft.title.replaceAll(placeholder, (_, key: string) => resolved.get(key) ?? '');
  // Fill escaped variable content after rendering to preserve the Markdown structure.
  const html = `<h1>${escape(title)}</h1>\n${markdownFragment(draft.markdown)
    .replaceAll(placeholder, (_, key: string) => escape(resolved.get(key) ?? ''))}\n`;
  const bytes = new TextEncoder().encode(html);
  if (bytes.byteLength > 512 * 1024) return { issues: [{ code: 'render_size_limit' }] };
  const checksum = await crypto.subtle.digest('SHA-256', bytes);
  const digest = Array.from(new Uint8Array(checksum), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { title, html, digest, variables: snapshot };
}
