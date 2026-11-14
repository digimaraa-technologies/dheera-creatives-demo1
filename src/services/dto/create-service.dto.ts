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

const IMAGE_URL = /^(?:\/uploads\/[a-z0-9-]+\/[a-z0-9-]+\.(?:jpe?g|png|webp|avif)|https?:\/\/\S+)$/i;
const IMAGE_FILENAME = /^[a-z0-9-]+\.(?:jpe?g|png|webp|avif)$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateServiceDto {
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
  @Matches(IMAGE_URL, {
    message: 'imageUrl must be a /uploads/... path or an http(s) URL',
  })
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(IMAGE_FILENAME)
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
