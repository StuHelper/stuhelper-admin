import type { LegalApi } from './api';

import { ApiError } from '#/shared/api/errors';

export async function loadDocumentPage(
  api: Pick<LegalApi, 'getCurrentDocument' | 'listDocuments'>,
  offset: number,
  signal: AbortSignal,
) {
  const page = await api.listDocuments(offset, signal);
  const slugs = [...new Set(page.items.map(({ slug }) => slug))];
  const current: Record<string, null | string | undefined> = Object.create(null);
  // The current published version can lie beyond this page or be different
  // from the newest publication. Ask the provider once per visible slug.
  for (let index = 0; index < slugs.length; index += 4) {
    signal.throwIfAborted();
    await Promise.all(
      slugs.slice(index, index + 4).map(async (slug) => {
        try {
          const document = await api.getCurrentDocument(slug, signal);
          current[slug] = document.version;
        } catch (error) {
          current[slug] = error instanceof ApiError && error.status === 404
            ? null
            : undefined;
        }
      }),
    );
  }
  return { ...page, current };
}
