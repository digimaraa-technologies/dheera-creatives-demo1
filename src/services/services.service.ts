import { Injectable } from '@nestjs/common';
import { CatalogItemDto } from '../common/catalog-item.dto';
import { CatalogResourceService } from '../common/catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

export type ServiceDto = CatalogItemDto;

@Injectable()
export class ServicesService extends CatalogResourceService {
  constructor(prisma: PrismaService, uploads: UploadsService) {
    super(prisma, uploads, 'service', { singular: 'service', title: 'Service' });
  }
}
