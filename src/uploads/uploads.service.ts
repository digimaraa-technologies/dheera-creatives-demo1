import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  UPLOAD_IMAGE_FILENAME,
  parseLocalImageUrl,
  type UploadFolder,
} from '../common/image-url';
import { uploadDir } from '../common/runtime-paths';
import { PrismaService } from '../prisma/prisma.service';
import { assertAllowedImage } from './validators/image-file.validator';

export interface StoredImage {
  imageUrl: string;
  imageFilename: string;
}

export interface OrphanUploadReport {
  /** Image files found in the managed folders. */
  scanned: number;
  /** Files still referenced by a product or service. */
  referenced: number;
  candidateCount: number;
  /** Safe relative identifiers such as `services/<uuid>.webp`. */
  candidates: string[];
}

const UPLOAD_FOLDERS: readonly UploadFolder[] = ['products', 'services'];

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Read at call time: ConfigModule runs when the module is imported, while
  // tests point UPLOAD_DIR at a temp directory afterwards.
  get rootDir(): string {
    return uploadDir(__dirname);
  }

  async save(folder: UploadFolder, file: Express.Multer.File | undefined): Promise<StoredImage> {
    // Hostinger managed Web Apps do not provide verified persistent storage for
    // app-directory uploads. Refuse to report success in production until durable
    // image storage is explicitly configured.
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'Durable image storage is not configured. Production image uploads are unavailable until persistent storage is set up.',
      );
    }

    const extension = assertAllowedImage(file);
    // UUID name only: the original filename never touches the filesystem.
    const imageFilename = `${randomUUID()}.${extension}`;
    const directory = join(this.rootDir, folder);

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, imageFilename), file!.buffer, { flag: 'wx' });

    return { imageUrl: `/uploads/${folder}/${imageFilename}`, imageFilename };
  }

  /**
   * Files are never deleted automatically. Between the "no record references
   * this image" check and the unlink, another product or service could start
   * referencing it, leaving a broken image. Making that atomic would require
   * every catalogue write to coordinate with the unlink across processes, so
   * cleanup is deferred to the admin-only orphan report instead.
   */
  deferCleanup(imageUrl: string): void {
    const parsed = parseLocalImageUrl(imageUrl);
    if (!parsed) return;
    this.logger.log(
      `Deferred upload cleanup: /uploads/${parsed.folder}/${parsed.filename} ` +
        '(see GET /api/admin/uploads/orphans)',
    );
  }

  /**
   * Admin-only dry run: lists image files that no product or service
   * references. Deletes nothing. Symlinks, directories, dotfiles such as
   * `.gitkeep` and non-image names are skipped.
   */
  async findOrphanUploads(): Promise<OrphanUploadReport> {
    const [products, services] = await Promise.all([
      this.prisma.product.findMany({ select: { imageUrl: true } }),
      this.prisma.service.findMany({ select: { imageUrl: true } }),
    ]);
    const referencedUrls = new Set([
      ...products.map((row) => row.imageUrl),
      ...services.map((row) => row.imageUrl),
    ]);

    let scanned = 0;
    let referenced = 0;
    const candidates: string[] = [];

    for (const folder of UPLOAD_FOLDERS) {
      let entries;
      try {
        entries = await readdir(join(this.rootDir, folder), { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      for (const entry of entries) {
        if (
          !entry.isFile() ||
          entry.name.startsWith('.') ||
          !UPLOAD_IMAGE_FILENAME.test(entry.name)
        ) {
          continue;
        }
        scanned += 1;
        if (referencedUrls.has(`/uploads/${folder}/${entry.name}`)) {
          referenced += 1;
        } else {
          candidates.push(`${folder}/${entry.name}`);
        }
      }
    }

    candidates.sort();
    return { scanned, referenced, candidateCount: candidates.length, candidates };
  }
}
