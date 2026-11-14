import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertAllowedImage } from './validators/image-file.validator';

export type UploadFolder = 'products' | 'services';

export interface StoredImage {
  imageUrl: string;
  imageFilename: string;
}

const SAFE_FILENAME = /^[a-z0-9-]+\.(?:jpe?g|png|webp|avif)$/i;

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  // Read at call time: ConfigModule runs when the module is imported, while
  // tests point UPLOAD_DIR at a temp directory afterwards.
  get rootDir(): string {
    return resolve(process.env.UPLOAD_DIR ?? 'uploads');
  }

  async save(folder: UploadFolder, file: Express.Multer.File | undefined): Promise<StoredImage> {
    const extension = assertAllowedImage(file);
    // UUID name only: the original filename never touches the filesystem.
    const imageFilename = `${randomUUID()}.${extension}`;
    const directory = join(this.rootDir, folder);

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, imageFilename), file!.buffer, { flag: 'wx' });

    return { imageUrl: `/uploads/${folder}/${imageFilename}`, imageFilename };
  }

  /** Deletes one stored image. Failures are logged, never thrown. */
  async delete(folder: UploadFolder, imageFilename: string): Promise<void> {
    if (!SAFE_FILENAME.test(imageFilename)) {
      this.logger.warn(`Refusing to delete unsafe filename in ${folder}: ${imageFilename}`);
      return;
    }

    const path = join(this.rootDir, folder, imageFilename);
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(`Failed to delete uploaded image ${path}: ${(error as Error).message}`);
      }
    }
  }

  /** Deletes the file behind a local /uploads/... URL; ignores external URLs. */
  async deleteByUrl(imageUrl: string): Promise<void> {
    const parsed = parseUploadUrl(imageUrl);
    if (parsed) {
      await this.delete(parsed.folder, parsed.filename);
    }
  }

  /** Best-effort cleanup of a just-uploaded file whose DB write failed. */
  async deleteNewUpload(imageUrl: string | undefined): Promise<void> {
    if (imageUrl?.startsWith('/uploads/')) {
      await this.deleteByUrl(imageUrl);
    }
  }
}

export function parseUploadUrl(
  imageUrl: string,
): { folder: UploadFolder; filename: string } | null {
  const match = /^\/uploads\/(products|services)\/([a-z0-9-]+\.(?:jpe?g|png|webp|avif))$/i.exec(
    imageUrl,
  );
  return match ? { folder: match[1] as UploadFolder, filename: match[2] } : null;
}
