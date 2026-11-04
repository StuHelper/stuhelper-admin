import { beforeEach, expect, it, vi } from 'vitest';

import { confirmLeave } from './confirm-leave';

const dialog = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('@vben/common-ui', () => dialog);

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('confirm', vi.fn(() => true)); });

it('leaves only after the Vben dialog is confirmed', async () => {
  dialog.confirm.mockResolvedValueOnce(undefined);
  await expect(confirmLeave('unsaved')).resolves.toBe(true);
  expect(dialog.confirm).toHaveBeenCalledWith({ content: 'unsaved', icon: 'warning' });
  expect(globalThis.confirm).not.toHaveBeenCalled();
});

it('stays on the page when the dialog is cancelled or closed', async () => {
  dialog.confirm.mockRejectedValueOnce(new Error('dialog cancelled'));
  await expect(confirmLeave('unsaved')).resolves.toBe(false);
});
