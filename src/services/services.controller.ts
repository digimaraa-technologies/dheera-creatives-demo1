import { Controller, Get, Param, Query } from '@nestjs/common';
import { PublicCatalogQueryDto } from '../common/catalog-query.dto';
import { Paginated } from '../common/pagination';
import { ServiceDto, ServicesService } from './services.service';

@Controller('api/services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(@Query() query: PublicCatalogQueryDto): Promise<Paginated<ServiceDto>> {
    return this.services.listPublic(query);
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string): Promise<ServiceDto> {
    return this.services.findBySlug(slug);
  }
}
