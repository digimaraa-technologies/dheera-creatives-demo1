import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  LOCAL_IMAGE_URL,
  UPLOAD_IMAGE_FILENAME,
} from './image-url';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CatalogItemDto {
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

export class CreateCatalogItemDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsString()
  @Length(1, 5000)
  description!: string;

  @IsString()
  @Length(1, 80)
  category!: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Matches(SLUG, {
    message: 'slug must contain lowercase letters, numbers and hyphens only',
  })
  slug?: string;

  @IsString()
  @MaxLength(2048)
  @Matches(LOCAL_IMAGE_URL, {
    message: 'imageUrl must be an uploaded /uploads/products/ or /uploads/services/ image path',
  })
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(UPLOAD_IMAGE_FILENAME, {
    message: 'imageFilename must be the UUID file name of an uploaded image',
  })
  imageFilename?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  price?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCatalogItemDto extends PartialType(CreateCatalogItemDto) {}
