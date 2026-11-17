// Catalogue images are only ever files uploaded through the admin dashboard,
// which names them with randomUUID(). A strict canonical UUID plus a raster
// extension rejects external hosts, protocol-relative URLs, unsafe schemes,
// query strings, encoded/plain traversal and arbitrary filenames.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXTENSION = '(?:jpe?g|png|webp|avif)';

export const UPLOAD_IMAGE_FILENAME = new RegExp(`^${UUID}\\.${EXTENSION}$`, 'i');

export const LOCAL_IMAGE_URL = new RegExp(
  `^/uploads/(?:products|services)/${UUID}\\.${EXTENSION}$`,
  'i',
);

const LOCAL_IMAGE_PARTS = new RegExp(
  `^/uploads/(products|services)/(${UUID}\\.${EXTENSION})$`,
  'i',
);

export type UploadFolder = 'products' | 'services';

export function parseLocalImageUrl(
  imageUrl: string,
): { folder: UploadFolder; filename: string } | null {
  const match = LOCAL_IMAGE_PARTS.exec(imageUrl);
  return match ? { folder: match[1] as UploadFolder, filename: match[2] } : null;
}
