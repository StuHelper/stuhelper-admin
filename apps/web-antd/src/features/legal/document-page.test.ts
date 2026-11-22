import type { AdminDocumentMetadata, PublicDocument } from './api';

import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '#/shared/api/errors';

import { loadDocumentPage } from './document-page';

const version = (slug: string, number: string): AdminDocumentMetadata => ({
  changed_variables: [],
  revision: 1,
  slug,
  status: 'draft',
  title: slug,
  version: number,
});

describe('loadDocumentPage', () => {
  it('uses the provider current version and distinguishes unpublished from unavailable', async () => {
    const signal = new AbortController().signal;
    const items = [
      version('terms', '3.1'),
      version('terms', '3.2'),
      version('privacy', '1.0'),
      version('email-transfer', '1.0'),
    ];
    const current: PublicDocument = {
      digest: 'a'.repeat(64),
      effective_date: '2026-11-22',
      html: '<h1>Terms</h1>',
      published_at: '2026-11-22T00:00:00Z',
      slug: 'terms',
      title: 'Terms',
      version: '3.0',
    };
    const listDocuments = vi.fn().mockResolvedValue({ items, next_offset: 24 });
    const getCurrentDocument = vi.fn()
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new ApiError('not_found', false, 404))
      .mockRejectedValueOnce(new ApiError('unavailable', false, 503));

    const result = await loadDocumentPage({ getCurrentDocument, listDocuments }, 20, signal);

    expect(listDocuments).toHaveBeenCalledWith(20, signal);
    expect(getCurrentDocument.mock.calls).toEqual([
      ['terms', signal], ['privacy', signal], ['email-transfer', signal],
    ]);
    expect(result).toMatchObject({
      current: { 'email-transfer': undefined, privacy: null, terms: '3.0' },
      items,
      next_offset: 24,
    });
  });
});
