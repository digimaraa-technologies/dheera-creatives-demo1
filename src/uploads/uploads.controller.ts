import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { StoredImage, UploadsService } from './uploads.service';
import { MAX_IMAGE_BYTES } from './validators/image-file.validator';

const IMAGE_UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
};

@Controller('api/admin/uploads')
@UseGuards(AdminAuthGuard)
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
}
