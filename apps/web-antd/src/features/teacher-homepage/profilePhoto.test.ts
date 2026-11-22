import { afterEach, describe, expect, it, vi } from 'vitest';

import { Http } from '#/shared/api/http';
import { Mutation } from '#/shared/api/mutation';

import { homepagePhotoLimit, TeacherHomepageProfileApi } from './profileApi';
import { encodeProfilePhoto, profilePhotoBlob } from './profilePhoto';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
const bytes = () => Uint8Array.from(atob(png), (byte) => byte.codePointAt(0)!);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('teacher homepage portraits', () => {
  it('rejects oversized and mislabeled images before decoding them', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const largeImage = new File([new Uint8Array(homepagePhotoLimit + 1)], 'large.png', { type: 'image/png' });
    await expect(encodeProfilePhoto(largeImage)).rejects.toMatchObject({ code: 'capacity_exceeded' });
    const wrongType = new File([bytes()], 'wrong.jpeg', { type: 'image/jpeg' });
    await expect(encodeProfilePhoto(wrongType)).rejects.toMatchObject({ code: 'invalid_input' });
    const wide = bytes();
    new DataView(wide.buffer).setUint32(16, 4097);
    await expect(encodeProfilePhoto(new File([wide], 'wide.png', { type: 'image/png' })))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(decode).not.toHaveBeenCalled();
  });

  it('sends standard base64 and preserves the image as a typed preview Blob', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close })));
    const photo = await encodeProfilePhoto(new File([bytes()], 'portrait.png', { type: 'image/png' }));
    expect(photo).toEqual({ content_type: 'image/png', data: png });
    expect(close).toHaveBeenCalledOnce();
    const blob = profilePhotoBlob(photo);
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes());
  });

  it('uses the authenticated photo endpoint with redirects disabled', async () => {
    const req = vi.fn<typeof fetch>(async () => new Response(bytes(), {
      headers: { 'Content-Type': 'image/png' },
    }));
    const api = new TeacherHomepageProfileApi(new Http(req));
    const blob = await api.getSavedPhoto('teacher/id', 'a'.repeat(64));
    expect(blob.type).toBe('image/png');
    expect(req).toHaveBeenCalledWith(
      `/api/v1/catalog/objects/teacher%2Fid/teacher-homepage/photos/${'a'.repeat(64)}`,
      expect.objectContaining({ credentials: 'same-origin', redirect: 'error' }),
    );
    req.mockResolvedValueOnce(new Response('<html lang="en"></html>', {
      headers: { 'Content-Type': 'text/html' },
    }));
    await expect(api.getSavedPhoto('teacher/id', 'a'.repeat(64)))
      .rejects.toMatchObject({ code: 'incompatible' });
  });
});

describe('teacher homepage profile writes', () => {
  it('replays the exact idempotency key and revision after a lost response', async () => {
    const req = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Network failure'))
      .mockResolvedValueOnce(Response.json({ teacher_id: 'teacher', revision: 8 }));
    const api = new TeacherHomepageProfileApi(new Http(req));
    const write = new Mutation();
    const input = {
      expected_revision: 7,
      page_visibility: 'hidden' as const,
      rules: [],
    };
    await expect(write.run('teacher', input, (body, key) => api.setControls('school', 'teacher', body, key)))
      .rejects.toMatchObject({ uncertain: true });
    await expect(write.retry()).resolves.toEqual({ teacher_id: 'teacher', revision: 8 });
    expect(req).toHaveBeenCalledTimes(2);
    expect(req.mock.calls[0]?.[0])
      .toBe('/api/v1/catalog/admin/schools/school/teacher-sites/teachers/teacher/homepage');
    const first = req.mock.calls[0]?.[1];
    const second = req.mock.calls[1]?.[1];
    expect(first?.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': expect.any(String) }));
    expect(second?.headers).toEqual(first?.headers);
    expect(first?.body).toBe(JSON.stringify(input));
    expect(second?.body).toBe(first?.body);
    expect(write.uncertain).toBe(false);
  });
});
