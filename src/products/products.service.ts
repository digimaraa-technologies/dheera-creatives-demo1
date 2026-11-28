import { Injectable } from '@nestjs/common';
import { CatalogItemDto } from '../common/catalog-item.dto';
import { CatalogResourceService } from '../common/catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

export type ProductDto = CatalogItemDto;

@Injectable()
export class ProductsService extends CatalogResourceService {
  constructor(prisma: PrismaService, uploads: UploadsService) {
    super(prisma, uploads, 'product', { singular: 'product', title: 'Product' });
  }
}
