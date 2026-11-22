import { expect, it, vi } from 'vitest';

import { Http } from '#/shared/api/http';

import { SettingsApi } from './settingsApi';

it('sends a revision, an explicit empty allowlist and the idempotency key', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ revision: 5, fields: [] }),
  );
  const api = new SettingsApi(new Http(fetcher));

  await expect(
    api.saveAllowlist('school/one', { expected_revision: 4, fields: [] }, 'original'),
  ).resolves.toEqual({ revision: 5, fields: [] });

  expect(fetcher).toHaveBeenCalledOnce();
  const [url, request] = fetcher.mock.calls[0]!;
  expect(url).toBe('/api/v1/catalog/admin/schools/school%2Fone/teacher-sites/allowlist');
  expect(request?.method).toBe('PUT');
  expect(new Headers(request?.headers).get('Idempotency-Key')).toBe('original');
  expect(request?.body).toBe('{"expected_revision":4,"fields":[]}');
});

it('rejects teacher eligibility counts missing the verified homepage count', async () => {
  const api = new SettingsApi(
    new Http(async () =>
      Response.json({ teaching: 10, official: 3, both: 2, eligible: 11 }),
    ),
  );

  await expect(api.readCounts('school')).rejects.toMatchObject({
    code: 'incompatible',
  });
});
