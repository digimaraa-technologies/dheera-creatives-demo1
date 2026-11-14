import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MIME_BY_EXTENSION = {
  jpg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  avif: ['image/avif'],
} as const;

export type ImageExtension = keyof typeof MIME_BY_EXTENSION;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Detects the real image format from the file signature (magic bytes). */
export function detectImageExtension(buffer: Buffer): ImageExtension | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
    buffer.subarray(8, 32).includes(Buffer.from('avif'))
  ) {
    return 'avif';
  }
  return null;
}

/**
 * Validates an uploaded image and returns its real extension.
 * Rejects anything whose bytes are not JPEG/PNG/WebP/AVIF, including SVG/HTML
 * disguised with an image MIME type.
 */
export function assertAllowedImage(file: Express.Multer.File | undefined): ImageExtension {
  if (!file) {
    throw new BadRequestException('An image file is required in the "image" field');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new PayloadTooLargeException('Image must be 5 MB or smaller');
  }

  const extension = detectImageExtension(file.buffer);
  if (!extension) {
    throw new BadRequestException(
      'Unsupported image content. Allowed formats: JPEG, PNG, WebP, AVIF',
    );
  }

  const allowedMimeTypes: readonly string[] = MIME_BY_EXTENSION[extension];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    throw new BadRequestException('File content does not match its declared image type');
  }

  return extension;
}
