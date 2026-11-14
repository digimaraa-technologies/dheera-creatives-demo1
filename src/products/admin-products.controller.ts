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
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductDto, ProductsService } from './products.service';

@Controller('api/admin/products')
@UseGuards(AdminAuthGuard)
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query() query: AdminCatalogQueryDto): Promise<Paginated<ProductDto>> {
    return this.products.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.products.findById(id);
  }

  @Post()
  create(@Body() dto: CreateProductDto): Promise<ProductDto> {
    return this.products.create(dto);
  }

  @Patch('reorder')
  reorder(
    @Body() dto: ReorderCatalogDto,
  ): Promise<{ success: true; updated: number }> {
    return this.products.reorder(dto.items);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDto> {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ success: true }> {
    return this.products.remove(id);
  }
}
