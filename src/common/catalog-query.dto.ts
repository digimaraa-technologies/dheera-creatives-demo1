import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const CATALOG_SORT_FIELDS = ['displayOrder', 'createdAt', 'name'] as const;
export type CatalogSortField = (typeof CATALOG_SORT_FIELDS)[number];

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class PublicCatalogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  search?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  category?: string;
}

export class AdminCatalogQueryDto extends PublicCatalogQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(CATALOG_SORT_FIELDS)
  sortBy: CatalogSortField = 'displayOrder';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'asc';
}
