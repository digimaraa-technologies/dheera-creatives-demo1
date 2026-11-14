import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminCatalogQueryDto } from '../common/catalog-query.dto';
import { Paginated } from '../common/pagination';
import { ReorderCatalogDto } from '../common/reorder.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServiceDto, ServicesService } from './services.service';

@Controller('api/admin/services')
@UseGuards(AdminAuthGuard)
export class AdminServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(@Query() query: AdminCatalogQueryDto): Promise<Paginated<ServiceDto>> {
    return this.services.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ServiceDto> {
    return this.services.findById(id);
  }

  @Post()
  create(@Body() dto: CreateServiceDto): Promise<ServiceDto> {
    return this.services.create(dto);
  }

  @Patch('reorder')
  reorder(
    @Body() dto: ReorderCatalogDto,
  ): Promise<{ success: true; updated: number }> {
    return this.services.reorder(dto.items);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<ServiceDto> {
    return this.services.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ success: true }> {
    return this.services.remove(id);
  }
}
