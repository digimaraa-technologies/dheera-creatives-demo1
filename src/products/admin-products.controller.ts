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
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminCatalogQueryDto } from '../common/catalog-query.dto';
import { Paginated } from '../common/pagination';
import { RATE_LIMITS } from '../common/rate-limit';
import { ReorderCatalogDto } from '../common/reorder.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductDto, ProductsService } from './products.service';

@Controller('api/admin/products')
@UseGuards(AdminAuthGuard, ThrottlerGuard)
@Throttle({ default: RATE_LIMITS.adminRead })
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
  @Throttle({ default: RATE_LIMITS.adminWrite })
  create(@Body() dto: CreateProductDto): Promise<ProductDto> {
    return this.products.create(dto);
  }

  @Patch('reorder')
  @Throttle({ default: RATE_LIMITS.adminWrite })
  reorder(
    @Body() dto: ReorderCatalogDto,
  ): Promise<{ success: true; updated: number }> {
    return this.products.reorder(dto.items);
  }

  @Patch(':id')
  @Throttle({ default: RATE_LIMITS.adminWrite })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDto> {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @Throttle({ default: RATE_LIMITS.adminWrite })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ success: true }> {
    return this.products.remove(id);
  }
}
