import { describe, expect, it, vi } from 'vitest';

import { availableMenus } from '#/menus';

import { createLegalMenuAccess } from './menu-access';

const list = '/api/v1/admin/legal/documents';
const empty = () => Response.json({ items: [] });

describe('legal navigation', () => {
  it('opens both legal entries only after the administrator list authorizes this session', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(empty());
    const access = createLegalMenuAccess(fetcher);
    const entries = () => availableMenus(() => true, access.allowed.value)
      .flatMap((group) => group.children ?? [])
      .filter((item) => item.path.startsWith('/system/legal/'))
      .map((item) => item.path);
    await access.changeSession(false);
    expect(entries()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    await access.changeSession(true);
    expect(entries()).toEqual(['/system/legal/documents', '/system/legal/variables']);
    const [url] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain(list);
    expect(new URL(String(url), 'https://example.test').searchParams.get('limit')).toBe('1');
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await access.transport('/api/v1/admin/legal/variables');
    expect(entries()).toEqual([]);
  });

  it('discards a successful discovery overtaken by sign-out and recovers from an unavailable list', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(empty());
    const access = createLegalMenuAccess(fetcher);
    const original = access.changeSession(true);
    await access.changeSession(false);
    finish(empty());
    await original;
    expect(access.allowed.value).toBe(false);

    await access.changeSession(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(access.allowed.value).toBe(false);
    await access.transport(list);
    await vi.waitFor(() => expect(access.allowed.value).toBe(true));
  });
});
