import type { AdminDocument } from './api';

import { createApp, nextTick, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '#/shared/api/errors';

import DocumentEditor from './DocumentEditor.vue';

const api = vi.hoisted(() => ({
  getVersion: vi.fn(),
  previewVersion: vi.fn(),
  publishVersion: vi.fn(),
  updateDraft: vi.fn(),
}));
vi.mock('./api', () => ({
  useLegalApi: () => api,
  validationIssues: () => [],
}));
vi.mock('#/shared/composables/leave', () => ({ useLeaveGuard: vi.fn() }));
vi.mock('#/shared/format', () => ({
  useFormat: () => ref({ calendarDate: String, number: String }),
}));
vi.mock('@vben/locales', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? [key, ...Object.values(values)].join(' ') : key,
    te: () => true,
  }),
}));

const draft: AdminDocument = {
  changed_variables: [],
  effective_date: '2026-11-22',
  markdown: 'Original body',
  revision: 2,
  slug: 'terms',
  status: 'draft',
  title: 'Original title',
  version: '3.1',
};
const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

async function mount(value = draft) {
  api.getVersion.mockResolvedValueOnce(value);
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(DocumentEditor, {
    selection: { slug: value.slug, version: value.version },
  });
  app.mount(root);
  cleanups.push(() => {
    app.unmount();
    root.remove();
  });
  await vi.waitFor(() => expect(root.querySelector('textarea, pre')).not.toBeNull());
  return root;
}

function button(label: string, root: ParentNode = document) {
  const matches = [...root.querySelectorAll('button')];
  const found = matches.find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

describe('DocumentEditor', () => {
  it('preserves edited text while fetching a conflicting draft and retries with its new revision', async () => {
    const root = await mount();
    api.getVersion.mockResolvedValueOnce({
      ...draft,
      markdown: 'Body saved by another administrator',
      revision: 3,
    });
    api.updateDraft.mockRejectedValueOnce(new ApiError('conflict', false, 409));
    api.updateDraft.mockResolvedValueOnce({ ...draft, markdown: 'My edit', revision: 4 });
    const textarea = root.querySelector('textarea')!;
    textarea.value = 'My edit';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    button('page.legal.documents.saveDraft', root).click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.common.compareNotice');
      expect(root.textContent).toContain('Body saved by another administrator');
    });
    expect(textarea.value).toBe('My edit');
    expect(api.getVersion).toHaveBeenNthCalledWith(2, 'terms', '3.1', expect.any(AbortSignal));
    expect(api.updateDraft).toHaveBeenCalledTimes(1);

    button('page.legal.documents.saveDraft', root).click();
    await vi.waitFor(() => expect(root.textContent).toContain('page.common.saved'));
    expect(api.updateDraft).toHaveBeenNthCalledWith(
      2,
      'terms',
      '3.1',
      3,
      { effective_date: draft.effective_date, markdown: 'My edit', title: draft.title },
      expect.any(String),
    );
    expect(api.updateDraft.mock.calls[0]?.[4]).not.toBe(api.updateDraft.mock.calls[1]?.[4]);
  });

  it('requires a new confirmation after the rendered publication digest changes', async () => {
    const root = await mount();
    const original = { digest: 'a'.repeat(64), html: '<h1>Original</h1>', title: 'Original' };
    const changed = { digest: 'b'.repeat(64), html: '<h1>Changed</h1>', title: 'Changed' };
    api.previewVersion.mockResolvedValueOnce(original).mockResolvedValue(changed);
    api.publishVersion.mockResolvedValue({ ...draft, revision: 3, status: 'published' });

    button('page.legal.documents.publish', root).click();
    const confirm = () => button('page.legal.documents.confirmPublish');
    await vi.waitFor(() => expect(confirm().disabled).toBe(false));
    confirm().click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('page.legal.documents.publicationChanged'));
    expect(api.publishVersion).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('');

    confirm().click();
    await vi.waitFor(() => expect(api.publishVersion).toHaveBeenCalledTimes(1));
    expect(api.previewVersion).toHaveBeenCalledTimes(3);
    expect(api.publishVersion).toHaveBeenCalledWith('terms', '3.1', 2, expect.any(String));
  });

  it('asks before closing a copy with a new version number', async () => {
    const root = await mount({ ...draft, status: 'published' });
    button('page.legal.documents.copyDraft', root).click();
    await nextTick();
    const input = root.querySelector<HTMLInputElement>('#legal-document-version')!;
    input.value = '3.2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    await nextTick();

    button('page.legal.documents.back', root).click();

    expect(confirm).toHaveBeenCalledWith('page.common.leaveUnsaved');
    expect(input.value).toBe('3.2');
  });
});
