import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PublicCatalogQueryDto } from '../common/catalog-query.dto';
import { Paginated } from '../common/pagination';
import { ProductDto, ProductsService } from './products.service';

@Controller('api/products')
@UseGuards(ThrottlerGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query() query: PublicCatalogQueryDto): Promise<Paginated<ProductDto>> {
    return this.products.listPublic(query);
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string): Promise<ProductDto> {
    return this.products.findBySlug(slug);
  }
}
