import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Service } from '@prisma/client';
import { AdminCatalogQueryDto, PublicCatalogQueryDto } from '../common/catalog-query.dto';
import { Paginated, pageArgs } from '../common/pagination';
import {
  ReorderItemDto,
  assertUniqueReorderItems,
} from '../common/reorder.dto';
import { slugify } from '../common/slug';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

export interface ServiceDto {
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
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async list(query: AdminCatalogQueryDto): Promise<Paginated<ServiceDto>> {
    return this.findPage(query, query.isActive);
  }

  async listPublic(query: PublicCatalogQueryDto): Promise<Paginated<ServiceDto>> {
    return this.findPage(query, true);
  }

  async findBySlug(slug: string): Promise<ServiceDto> {
    const service = await this.prisma.service.findFirst({
      where: { slug, isActive: true },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return toDto(service);
  }

  async findById(id: string): Promise<ServiceDto> {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return toDto(service);
  }

  async create(dto: CreateServiceDto): Promise<ServiceDto> {
    const slug = this.resolveSlug(dto.slug ?? dto.name);

    try {
      const service = await this.prisma.service.create({
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
      return toDto(service);
    } catch (error) {
      // The image was uploaded before this request; drop it if the write failed.
      await this.uploads.deleteNewUpload(dto.imageUrl);
      throw mapWriteError(error);
    }
  }

  async update(id: string, dto: UpdateServiceDto): Promise<ServiceDto> {
    const existing = await this.prisma.service.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Service not found');
    }

    const data: Prisma.ServiceUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.slug !== undefined) data.slug = this.resolveSlug(dto.slug);
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.imageFilename !== undefined) data.imageFilename = dto.imageFilename;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    let updated: Service;
    try {
      updated = await this.prisma.service.update({ where: { id }, data });
    } catch (error) {
      // The new file was uploaded before this request; drop it if the write failed.
      if (dto.imageUrl !== undefined && dto.imageUrl !== existing.imageUrl) {
        await this.uploads.deleteNewUpload(dto.imageUrl);
      }
      throw mapWriteError(error);
    }

    if (updated.imageUrl !== existing.imageUrl) {
      await this.uploads.deleteByUrl(existing.imageUrl);
    }

    return toDto(updated);
  }

  async remove(id: string): Promise<{ success: true }> {
    const existing = await this.prisma.service.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Service not found');
    }

    await this.prisma.service.delete({ where: { id } });
    // Cleanup failures are logged inside the service and never fail the delete.
    await this.uploads.deleteByUrl(existing.imageUrl);

    return { success: true };
  }

  async reorder(
    items: ReorderItemDto[],
  ): Promise<{ success: true; updated: number }> {
    assertUniqueReorderItems(items, 'service');

    const ids = items.map((item) => item.id);
    const found = await this.prisma.service.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new NotFoundException('One or more services were not found');
    }

    try {
      // Array form runs every update in one transaction: all or nothing.
      await this.prisma.$transaction(
        items.map((item) =>
          this.prisma.service.update({
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
        throw new NotFoundException('One or more services were not found');
      }
      throw error;
    }

    return { success: true, updated: items.length };
  }

  private async findPage(
    query: PublicCatalogQueryDto & Partial<AdminCatalogQueryDto>,
    isActive: boolean | undefined,
  ): Promise<Paginated<ServiceDto>> {
    const where: Prisma.ServiceWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (query.category) where.category = query.category;
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const { skip, take } = pageArgs(query.page, query.pageSize);
    const orderBy = {
      [query.sortBy ?? 'displayOrder']: query.sortDir ?? 'asc',
    } as Prisma.ServiceOrderByWithRelationInput;

    const [total, services, categories] = await this.prisma.$transaction([
      this.prisma.service.count({ where }),
      this.prisma.service.findMany({ where, orderBy, skip, take }),
      this.prisma.service.findMany({
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
    ]);

    return {
      items: services.map(toDto),
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

function toDto(service: Service): ServiceDto {
  return {
    id: service.id,
    name: service.name,
    slug: service.slug,
    description: service.description,
    category: service.category,
    imageUrl: service.imageUrl,
    imageFilename: service.imageFilename,
    price: service.price === null ? null : Number(service.price),
    displayOrder: service.displayOrder,
    isActive: service.isActive,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

function mapWriteError(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException('A service with this slug already exists');
  }
  return error instanceof Error ? error : new Error('Unexpected database error');
}
