import { describe, expect, it, vi } from 'vitest';

import { AcademicAdminApi } from './api';

// Records the request path of each call; responses are not inspected here. The fake
// implements only json(), the one Http method these reads use, hence the cast.
function fake() {
  const paths: string[] = [];
  const http = { json: vi.fn(async (path: string) => { paths.push(path); return { items: [], next: '' }; }) };
  return { api: new AcademicAdminApi(http as never), paths };
}

describe('catalog reads hidden from the public catalog', () => {
  it('reads teaching classes, offerings and schedules from the maintenance endpoint', async () => {
    const { api, paths } = fake();
    for (const kind of ['class', 'term_course', 'assignment', 'schedule']) await api.objects({ kind, school_id: 's' });
    await api.objects({ kind: 'teacher', school_id: 's', class_id: 'c' });
    expect(paths).toEqual(Array.from({ length: 5 }, () => '/api/v1/catalog/admin/objects'));
  });

  it('keeps public reads for visible kinds and for lists without a school', async () => {
    const { api, paths } = fake();
    await api.objects({ kind: 'teacher', school_id: 's' });
    await api.objects({ kind: 'school' });
    await api.objects({ kind: 'class' });
    expect(paths).toEqual(['/api/v1/catalog/objects', '/api/v1/catalog/objects', '/api/v1/catalog/objects']);
  });

  it('uses the maintenance endpoint for maintenance lists and summaries', async () => {
    const { api, paths } = fake();
    await api.objects({ kind: 'course', school_id: 's' }, undefined, true);
    await api.summary('x').catch(() => undefined);
    expect(paths).toEqual(['/api/v1/catalog/admin/objects', '/api/v1/catalog/admin/objects/x/summary']);
  });
});
