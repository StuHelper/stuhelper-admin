import type { AdminDocumentMetadata, Variable } from './api';

import { createApp, defineComponent, h, nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '#/shared/api/errors';

import VariablesView from './VariablesView.vue';

const api = vi.hoisted(() => ({
  createVariable: vi.fn(),
  deleteVariable: vi.fn(),
  getVariable: vi.fn(),
  listDocuments: vi.fn(),
  listVariables: vi.fn(),
  updateVariable: vi.fn(),
}));
vi.mock('./api', () => ({ useLegalApi: () => api }));
vi.mock('#/shared/composables/leave', () => ({ useLeaveGuard: vi.fn() }));
vi.mock('#/shared/format', () => ({ useFormat: () => ({ number: String }) }));
vi.mock('@vben/locales', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? [key, ...Object.values(values)].join(' ') : key,
    te: () => true,
  }),
}));
vi.mock('#/shared/ui/AdminPage.vue', () => ({
  default: defineComponent({
    inheritAttrs: false,
    props: { title: { required: true, type: String } },
    setup(props, { slots }) {
      return () =>
        h('main', [h('h1', props.title), slots.extra?.(), slots.default?.()]);
    },
  }),
}));

const variable: Variable = {
  description: 'Public contact mailbox',
  key: 'operator_email',
  revision: 7,
  updated_at: '2026-11-22T00:00:00Z',
  updated_by: { issuer: 'https://issuer.example', subject: 'admin' },
  value: 'initial@example.org',
};

function version(
  title: string,
  status: AdminDocumentMetadata['status'],
  changed_variables: string[],
): AdminDocumentMetadata {
  return {
    changed_variables,
    revision: 3,
    slug: title.toLowerCase(),
    status,
    title,
    version: '3.1',
  };
}

const cleanups = new Set<() => void>();
beforeEach(() => {
  vi.resetAllMocks();
  api.listVariables.mockResolvedValue({ items: [variable] });
  api.listDocuments.mockResolvedValue({ items: [] });
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
});

async function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(VariablesView);
  app.mount(root);
  function unmount() {
    cleanups.delete(unmount);
    app.unmount();
    root.remove();
  }
  cleanups.add(unmount);
  await vi.waitFor(() => expect(root.textContent).toContain(variable.key));
  return { root, unmount };
}

function button(label: string, root: ParentNode = document) {
  const found = [...root.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}

function modal() {
  const found = document.querySelector('.ant-modal');
  expect(found).toBeTruthy();
  return found!;
}

function enterValue(label: string, value: string) {
  const field = inputFor(label);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return field;
}

function inputFor(label: string) {
  const labelElement = [...modal().querySelectorAll('label')].find(
    (item) => item.textContent?.trim() === label,
  );
  const field = labelElement?.control;
  if (
    !(field instanceof HTMLInputElement) &&
    !(field instanceof HTMLTextAreaElement)
  )
    throw new Error(`Missing field: ${label}`);
  return field;
}

describe('Legal variables', () => {
  it('validates a new key and UTF-8 byte limits, then accepts a blank value', async () => {
    api.createVariable.mockResolvedValue({
      ...variable,
      key: 'retention',
      value: '',
    });
    const { root } = await mount();
    button('page.legal.variables.newVariable', root).click();
    await nextTick();

    enterValue('page.legal.variables.key', 'document_version');
    enterValue('page.legal.variables.description', '说'.repeat(171));
    enterValue('page.legal.variables.value', '数'.repeat(1366));
    button('page.common.save', modal()).click();
    await nextTick();

    expect(api.createVariable).not.toHaveBeenCalled();
    expect(modal().textContent).toContain('page.legal.variables.invalidKey');
    expect(modal().textContent).toContain(
      'page.legal.variables.invalidDescription',
    );
    expect(modal().textContent).toContain('page.legal.variables.invalidValue');

    enterValue('page.legal.variables.key', 'retention');
    enterValue('page.legal.variables.description', 'Retention');
    enterValue('page.legal.variables.value', '');
    button('page.common.save', modal()).click();
    await vi.waitFor(() =>
      expect(root.textContent).toContain('page.legal.variables.noImpact'),
    );
    expect(api.createVariable).toHaveBeenCalledWith(
      { description: 'Retention', key: 'retention', value: '' },
      expect.any(String),
    );
  });

  it('shows a duplicate-key error on the field, preserves input and accepts a different key', async () => {
    api.createVariable
      .mockRejectedValueOnce(new ApiError('already_exists', false, 409))
      .mockResolvedValueOnce({ ...variable, key: 'another_key' });

    const { root } = await mount();
    button('page.legal.variables.newVariable', root).click();
    await nextTick();
    const key = enterValue('page.legal.variables.key', variable.key);
    const description = enterValue(
      'page.legal.variables.description',
      'A new variable',
    );
    const value = enterValue('page.legal.variables.value', 'a new value');
    button('page.common.save', modal()).click();

    await vi.waitFor(() => {
      expect(modal().textContent).toContain(
        'page.legal.variables.alreadyExists',
      );
    });
    expect(key.getAttribute('aria-invalid')).toBe('true');
    expect(description.value).toBe('A new variable');
    expect(value.value).toBe('a new value');

    enterValue('page.legal.variables.key', 'another_key');
    await nextTick();
    expect(modal().textContent).not.toContain(
      'page.legal.variables.alreadyExists',
    );
    expect(key.getAttribute('aria-invalid')).toBe('false');
    button('page.common.save', modal()).click();
    await vi.waitFor(() =>
      expect(root.textContent).toContain('page.common.saved'),
    );
    expect(api.createVariable).toHaveBeenNthCalledWith(
      2,
      {
        description: 'A new variable',
        key: 'another_key',
        value: 'a new value',
      },
      expect.any(String),
    );
  });

  it('keeps the editing input after a conflict, uses the reloaded revision, and reports matching published versions across pages', async () => {
    api.updateVariable
      .mockRejectedValueOnce(new ApiError('conflict', false, 409))
      .mockResolvedValueOnce({
        ...variable,
        revision: 9,
        value: 'mine@example.org',
      });
    api.getVariable.mockResolvedValue({
      ...variable,
      revision: 8,
      value: 'latest@example.org',
    });
    api.listDocuments
      .mockResolvedValueOnce({
        items: [
          version('Archived', 'archived', [variable.key]),
          version('Other', 'published', ['unrelated']),
        ],
        next_offset: 100,
      })
      .mockResolvedValueOnce({
        items: [version('Affected', 'published', [variable.key])],
      });

    const { root } = await mount();
    button('page.common.edit', root).click();
    await nextTick();
    const value = enterValue('page.legal.variables.value', 'mine@example.org');
    button('page.common.save', modal()).click();

    await vi.waitFor(() =>
      expect(modal().textContent).toContain('page.common.compareNotice'),
    );
    expect(api.getVariable).toHaveBeenCalledWith(
      variable.key,
      expect.any(AbortSignal),
    );
    expect(value.value).toBe('mine@example.org');
    expect(modal().textContent).toContain('latest@example.org');
    button('page.common.save', modal()).click();

    await vi.waitFor(() => expect(root.textContent).toContain('Affected'));
    expect(root.textContent).not.toContain('Archived');
    expect(root.textContent).not.toContain('Other');
    expect(api.listDocuments).toHaveBeenNthCalledWith(
      2,
      100,
      expect.any(AbortSignal),
      100,
    );
    expect(api.updateVariable).toHaveBeenNthCalledWith(
      1,
      variable.key,
      7,
      { description: variable.description, value: 'mine@example.org' },
      expect.any(String),
    );
    expect(api.updateVariable).toHaveBeenNthCalledWith(
      2,
      variable.key,
      8,
      { description: variable.description, value: 'mine@example.org' },
      expect.any(String),
    );
    expect(api.updateVariable.mock.calls[0]?.[3]).not.toBe(
      api.updateVariable.mock.calls[1]?.[3],
    );
  });

  it('shows scan progress instead of claiming no impact until all pages are checked', async () => {
    api.updateVariable.mockResolvedValue(variable);
    api.listDocuments.mockImplementation(async (offset: number) =>
      offset < 500
        ? { items: [], next_offset: offset + 100 }
        : { items: [version('Tail', 'published', [variable.key])] },
    );

    const { root } = await mount();
    button('page.common.edit', root).click();
    await nextTick();
    enterValue('page.legal.variables.value', 'changed@example.org');
    button('page.common.save', modal()).click();

    await vi.waitFor(() => {
      expect(root.textContent).toContain('page.legal.variables.impactPartial');
    });
    expect(api.listDocuments).toHaveBeenCalledTimes(5);
    expect(root.textContent).not.toContain('page.legal.variables.noImpact');
    button('page.legal.variables.continueImpact', root).click();
    await vi.waitFor(() => expect(root.textContent).toContain('Tail'));
    expect(api.listDocuments).toHaveBeenCalledTimes(6);
    expect(root.textContent).not.toContain(
      'page.legal.variables.impactPartial',
    );
  });

  it('discards a delayed variable list when the impact request reports an expired session', async () => {
    let resolveList!: (result: { items: Variable[] }) => void;
    let listSignal: AbortSignal | undefined;
    const delayedList = new Promise<{ items: Variable[] }>((resolve) => {
      resolveList = resolve;
    });
    api.listVariables
      .mockResolvedValueOnce({ items: [variable] })
      .mockImplementationOnce((_offset: number, signal: AbortSignal) => {
        listSignal = signal;
        return delayedList;
      });
    api.updateVariable.mockResolvedValue(variable);
    api.listDocuments.mockRejectedValueOnce(
      new ApiError('unauthenticated', false, 401),
    );

    const { root } = await mount();
    button('page.common.edit', root).click();
    await nextTick();
    enterValue('page.legal.variables.value', 'attempted@example.org');
    button('page.common.save', modal()).click();

    await vi.waitFor(() =>
      expect(root.textContent).toContain('page.errors.unauthenticated'),
    );
    expect(listSignal?.aborted).toBe(true);
    resolveList({ items: [variable] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).not.toContain(variable.key);
    expect(root.textContent).not.toContain(variable.value);
    expect(root.textContent).not.toContain(
      'page.legal.variables.impactedTitle',
    );
  });

  it('does not start follow-up reads when a write resolves after the view is unmounted', async () => {
    let resolveWrite!: (result: Variable) => void;
    const delayedWrite = new Promise<Variable>((resolve) => {
      resolveWrite = resolve;
    });
    api.updateVariable.mockReturnValueOnce(delayedWrite);

    const { root, unmount } = await mount();
    button('page.common.edit', root).click();
    await nextTick();
    enterValue(
      'page.legal.variables.value',
      'after-session-switch@example.org',
    );
    button('page.common.save', modal()).click();
    await vi.waitFor(() => expect(api.updateVariable).toHaveBeenCalledTimes(1));
    unmount();
    resolveWrite(variable);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.listVariables).toHaveBeenCalledTimes(1);
    expect(api.listDocuments).not.toHaveBeenCalled();
  });

  it('replays an uncertain deletion exactly and clears protected data if the retry is forbidden', async () => {
    api.deleteVariable
      .mockRejectedValueOnce(new ApiError('network', true))
      .mockRejectedValueOnce(new ApiError('forbidden', false, 403));

    const { root } = await mount();
    button('page.legal.variables.deleteVariable', root).click();
    await nextTick();
    button('page.legal.variables.deleteVariable', modal()).click();

    await vi.waitFor(() =>
      expect(modal().textContent).toContain('page.common.uncertain'),
    );
    expect(button('page.common.cancel', modal()).disabled).toBe(true);
    expect(
      button('page.legal.variables.deleteVariable', modal()).disabled,
    ).toBe(true);
    button('page.common.retryOriginal', modal()).click();

    await vi.waitFor(() =>
      expect(root.textContent).toContain('page.errors.forbidden'),
    );
    expect(api.deleteVariable).toHaveBeenCalledTimes(2);
    expect(api.deleteVariable.mock.calls[0]).toEqual([
      variable.key,
      7,
      expect.any(String),
    ]);
    expect(api.deleteVariable.mock.calls[1]).toEqual(
      api.deleteVariable.mock.calls[0],
    );
    expect(root.textContent).not.toContain(variable.key);
    expect(root.textContent).not.toContain(variable.value);
    expect(api.listDocuments).not.toHaveBeenCalled();
  });
});
