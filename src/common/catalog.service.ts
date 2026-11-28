import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  CatalogItemDto,
  CreateCatalogItemDto,
  UpdateCatalogItemDto,
} from './catalog-item.dto';
import { AdminCatalogQueryDto, PublicCatalogQueryDto } from './catalog-query.dto';
import { parseLocalImageUrl } from './image-url';
import { Paginated, pageArgs } from './pagination';
import { ReorderItemDto, assertUniqueReorderItems } from './reorder.dto';
import { slugify } from './slug';

interface CatalogRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  imageUrl: string;
  imageFilename: string | null;
  price: Prisma.Decimal | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CatalogDelegate {
  findFirst(args: Record<string, unknown>): Prisma.PrismaPromise<CatalogRow | null>;
  findUnique(args: Record<string, unknown>): Prisma.PrismaPromise<CatalogRow | null>;
  findMany(args: Record<string, unknown>): Prisma.PrismaPromise<CatalogRow[]>;
  count(args?: Record<string, unknown>): Prisma.PrismaPromise<number>;
  create(args: Record<string, unknown>): Prisma.PrismaPromise<CatalogRow>;
  update(args: Record<string, unknown>): Prisma.PrismaPromise<CatalogRow>;
  delete(args: Record<string, unknown>): Prisma.PrismaPromise<CatalogRow>;
}

/**
 * Shared CRUD, pagination, slug, and atomic reorder implementation for
 * identical catalog tables (`products` and `services`).
 */
export class CatalogResourceService {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly uploads: UploadsService,
    private readonly model: 'product' | 'service',
    private readonly labels: { singular: string; title: string },
  ) {}

  private get delegate(): CatalogDelegate {
    return this.prisma[this.model] as unknown as CatalogDelegate;
  }

  async list(query: AdminCatalogQueryDto): Promise<Paginated<CatalogItemDto>> {
    return this.findPage(query, query.isActive, false);
  }

  async listPublic(query: PublicCatalogQueryDto): Promise<Paginated<CatalogItemDto>> {
    return this.findPage(query, true, true);
  }

  async findBySlug(slug: string): Promise<CatalogItemDto> {
    const row = await this.delegate.findFirst({
      where: { slug, isActive: true },
    });
    if (!row) {
      throw new NotFoundException(`${this.labels.title} not found`);
    }
    return toDto(row);
  }

  async findById(id: string): Promise<CatalogItemDto> {
    const row = await this.delegate.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`${this.labels.title} not found`);
    }
    return toDto(row);
  }

  async create(dto: CreateCatalogItemDto): Promise<CatalogItemDto> {
    const slug = this.resolveSlug(dto.slug ?? dto.name);

    try {
      const row = await this.delegate.create({
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
      return toDto(row);
    } catch (error) {
      // The image was uploaded before this request; cleanup is deferred to the
      // orphan report if the write failed.
      this.uploads.deferCleanup(dto.imageUrl);
      throw this.mapWriteError(error);
    }
  }

  async update(id: string, dto: UpdateCatalogItemDto): Promise<CatalogItemDto> {
    const existing = await this.delegate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`${this.labels.title} not found`);
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.slug !== undefined) data.slug = this.resolveSlug(dto.slug);
    if (dto.imageUrl !== undefined) {
      data.imageUrl = dto.imageUrl;
      if (dto.imageFilename === undefined) {
        data.imageFilename = parseLocalImageUrl(dto.imageUrl)?.filename ?? null;
      }
    }
    if (dto.imageFilename !== undefined) data.imageFilename = dto.imageFilename;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    let updated: CatalogRow;
    try {
      updated = await this.delegate.update({ where: { id }, data });
    } catch (error) {
      // The new file was uploaded before this request; cleanup is deferred if
      // the write failed.
      if (dto.imageUrl !== undefined && dto.imageUrl !== existing.imageUrl) {
        this.uploads.deferCleanup(dto.imageUrl);
      }
      throw this.mapWriteError(error);
    }

    if (updated.imageUrl !== existing.imageUrl) {
      this.uploads.deferCleanup(existing.imageUrl);
    }

    return toDto(updated);
  }

  async remove(id: string): Promise<{ success: true }> {
    const existing = await this.delegate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`${this.labels.title} not found`);
    }

    await this.delegate.delete({ where: { id } });
    // Nothing is unlinked automatically; the orphan report lists the file.
    this.uploads.deferCleanup(existing.imageUrl);

    return { success: true };
  }

  async reorder(
    items: ReorderItemDto[],
  ): Promise<{ success: true; updated: number }> {
    assertUniqueReorderItems(items, this.labels.singular);

    const ids = items.map((item) => item.id);
    const found = await this.delegate.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new NotFoundException(`One or more ${this.labels.singular}s were not found`);
    }

    try {
      // Array form runs every update in one transaction: all or nothing.
      await this.prisma.$transaction(
        items.map((item) =>
          this.delegate.update({
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
        throw new NotFoundException(`One or more ${this.labels.singular}s were not found`);
      }
      throw error;
    }

    return { success: true, updated: items.length };
  }

  private async findPage(
    query: PublicCatalogQueryDto & Partial<AdminCatalogQueryDto>,
    isActive: boolean | undefined,
    activeCategoriesOnly: boolean,
  ): Promise<Paginated<CatalogItemDto>> {
    const where: Record<string, unknown> = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (query.category) where.category = query.category;
    // Case-insensitive matching relies on the database string collation (utf8mb4 *_ci).
    if (query.search) where.name = { contains: query.search };

    const { skip, take } = pageArgs(query.page, query.pageSize);
    const orderBy = { [query.sortBy ?? 'displayOrder']: query.sortDir ?? 'asc' };

    const [total, rows, categories] = await this.prisma.$transaction([
      this.delegate.count({ where }),
      this.delegate.findMany({ where, orderBy, skip, take }),
      this.delegate.findMany({
        distinct: ['category'],
        where: activeCategoriesOnly ? { isActive: true } : {},
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
    ]);

    return {
      items: rows.map(toDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      categories: (categories as unknown as Array<{ category: string }>).map(
        (row) => row.category,
      ),
    };
  }

  private resolveSlug(value: string): string {
    const slug = slugify(value);
    if (!slug) {
      throw new BadRequestException('Slug cannot be empty');
    }
    return slug;
  }

  private mapWriteError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(`A ${this.labels.singular} with this slug already exists`);
    }
    return error instanceof Error ? error : new Error('Unexpected database error');
  }
}

function toDto(row: CatalogRow): CatalogItemDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category,
    imageUrl: row.imageUrl,
    imageFilename: row.imageFilename,
    price: row.price === null ? null : Number(row.price),
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
