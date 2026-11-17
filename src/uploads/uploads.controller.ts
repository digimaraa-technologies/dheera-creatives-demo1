import {
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { RATE_LIMITS } from '../common/rate-limit';
import {
  OrphanUploadReport,
  StoredImage,
  UploadsService,
} from './uploads.service';
import { MAX_IMAGE_BYTES } from './validators/image-file.validator';

const IMAGE_UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
};

@Controller('api/admin/uploads')
@UseGuards(AdminAuthGuard, ThrottlerGuard)
@Throttle({ default: RATE_LIMITS.uploads })
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('products')
  @UseInterceptors(FileInterceptor('image', IMAGE_UPLOAD_OPTIONS))
  uploadProduct(@UploadedFile() file?: Express.Multer.File): Promise<StoredImage> {
    return this.uploads.save('products', file);
  }

  @Post('services')
  @UseInterceptors(FileInterceptor('image', IMAGE_UPLOAD_OPTIONS))
  uploadService(@UploadedFile() file?: Express.Multer.File): Promise<StoredImage> {
    return this.uploads.save('services', file);
  }

  // Dry run only: reports unreferenced files and deletes nothing.
  @Get('orphans')
  orphans(): Promise<OrphanUploadReport> {
    return this.uploads.findOrphanUploads();
  }
}
