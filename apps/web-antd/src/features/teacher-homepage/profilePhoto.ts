import type { CatalogSchemas } from './catalog';

import { ApiError } from '#/shared/api/errors';

import { homepagePhotoLimit } from './profileApi';

type PhotoUpload = CatalogSchemas['TeacherHomepagePortraitUpload'];

const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function pngDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 24 ||
    !pngSignature.every((byte, index) => bytes[index] === byte) ||
    String.fromCodePoint(...bytes.slice(12, 16)) !== 'IHDR'
  ) {
    return;
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(8) !== 13) return;
  return { width: header.getUint32(16), height: header.getUint32(20) };
}

function jpegDimensions(bytes: Uint8Array) {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xFF) {
    while (bytes[offset] === 0xFF) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xDA || marker === 0xD9) return;
    if (offset + 2 > bytes.length) return;
    const length = header.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return;
    // The start-of-frame segment describes the decoded image dimensions.
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
      if (length < 8) return;
      return {
        width: header.getUint16(offset + 5),
        height: header.getUint16(offset + 3),
      };
    }
    offset += length;
  }
}

function validPhotoSize(size: undefined | { height: number; width: number; }) {
  return (
    !!size &&
    size.width > 0 &&
    size.height > 0 &&
    size.width <= 4096 &&
    size.height <= 4096 &&
    size.width * size.height <= 8_388_608
  );
}

export async function encodeProfilePhoto(file: File): Promise<PhotoUpload> {
  if (file.size > homepagePhotoLimit) throw new ApiError('capacity_exceeded');
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    throw new ApiError('invalid_input');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = file.type === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes);
  // Check header dimensions before asking the browser to decode compressed data.
  if (!validPhotoSize(size)) throw new ApiError('invalid_input');

  const image = await createImageBitmap(file);
  try {
    if (!validPhotoSize(image)) throw new ApiError('invalid_input');
  } finally {
    image.close();
  }

  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + 16_384));
  }
  return { content_type: file.type, data: btoa(binary) };
}

export function profilePhotoBlob(value: PhotoUpload) {
  const bytes = Uint8Array.from(atob(value.data), (byte) => byte.codePointAt(0)!);
  return new Blob([bytes], { type: value.content_type });
}
