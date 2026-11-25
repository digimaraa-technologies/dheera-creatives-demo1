import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { AdminCatalogQueryDto, PublicCatalogQueryDto } from '../common/catalog-query.dto';
import { Paginated, pageArgs } from '../common/pagination';
import {
  ReorderItemDto,
  assertUniqueReorderItems,
} from '../common/reorder.dto';
import { slugify } from '../common/slug';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

export interface ProductDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  imageUrl: string;
  imageFilename: string | null;
  price: number | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async list(query: AdminCatalogQueryDto): Promise<Paginated<ProductDto>> {
    return this.findPage(query, query.isActive, false);
  }

  async listPublic(query: PublicCatalogQueryDto): Promise<Paginated<ProductDto>> {
    return this.findPage(query, true, true);
  }

  async findBySlug(slug: string): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return toDto(product);
  }

  async findById(id: string): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return toDto(product);
  }

  async create(dto: CreateProductDto): Promise<ProductDto> {
    const slug = this.resolveSlug(dto.slug ?? dto.name);

    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,
          category: dto.category,
          imageUrl: dto.imageUrl,
          imageFilename: dto.imageFilename ?? null,
          price: dto.price ?? null,
          displayOrder: dto.displayOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
      return toDto(product);
    } catch (error) {
      // The image was uploaded before this request; cleanup is deferred to the
      // orphan report if the write failed.
      this.uploads.deferCleanup(dto.imageUrl);
      throw mapWriteError(error);
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductDto> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.slug !== undefined) data.slug = this.resolveSlug(dto.slug);
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.imageFilename !== undefined) data.imageFilename = dto.imageFilename;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    let updated: Product;
    try {
      updated = await this.prisma.product.update({ where: { id }, data });
    } catch (error) {
      // The new file was uploaded before this request; cleanup is deferred if
      // the write failed.
      if (dto.imageUrl !== undefined && dto.imageUrl !== existing.imageUrl) {
        this.uploads.deferCleanup(dto.imageUrl);
      }
      throw mapWriteError(error);
    }

    if (updated.imageUrl !== existing.imageUrl) {
      this.uploads.deferCleanup(existing.imageUrl);
    }

    return toDto(updated);
  }

  async remove(id: string): Promise<{ success: true }> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.product.delete({ where: { id } });
    // Nothing is unlinked automatically; the orphan report lists the file.
    this.uploads.deferCleanup(existing.imageUrl);

    return { success: true };
  }

  async reorder(
    items: ReorderItemDto[],
  ): Promise<{ success: true; updated: number }> {
    assertUniqueReorderItems(items, 'product');

    const ids = items.map((item) => item.id);
    const found = await this.prisma.product.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new NotFoundException('One or more products were not found');
    }

    try {
      // Array form runs every update in one transaction: all or nothing.
      await this.prisma.$transaction(
        items.map((item) =>
          this.prisma.product.update({
            where: { id: item.id },
            data: { displayOrder: item.displayOrder },
          }),
        ),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('One or more products were not found');
      }
      throw error;
    }

    return { success: true, updated: items.length };
  }

  private async findPage(
    query: PublicCatalogQueryDto & Partial<AdminCatalogQueryDto>,
    isActive: boolean | undefined,
    activeCategoriesOnly: boolean,
  ): Promise<Paginated<ProductDto>> {
    const where: Prisma.ProductWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (query.category) where.category = query.category;
    // Case-insensitive matching relies on the database string collation (utf8mb4 *_ci).
    if (query.search) where.name = { contains: query.search };

    const { skip, take } = pageArgs(query.page, query.pageSize);
    const orderBy = {
      [query.sortBy ?? 'displayOrder']: query.sortDir ?? 'asc',
    } as Prisma.ProductOrderByWithRelationInput;

    const [total, products, categories] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, orderBy, skip, take }),
      this.prisma.product.findMany({
        distinct: ['category'],
        where: activeCategoriesOnly ? { isActive: true } : {},
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
    ]);

    return {
      items: products.map(toDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      categories: categories.map((row) => row.category),
    };
  }

  private resolveSlug(value: string): string {
    const slug = slugify(value);
    if (!slug) {
      throw new BadRequestException('Slug cannot be empty');
    }
    return slug;
  }
}

function toDto(product: Product): ProductDto {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    category: product.category,
    imageUrl: product.imageUrl,
    imageFilename: product.imageFilename,
    price: product.price === null ? null : Number(product.price),
    displayOrder: product.displayOrder,
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function mapWriteError(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException('A product with this slug already exists');
  }
  return error instanceof Error ? error : new Error('Unexpected database error');
}
