import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReorderItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  displayOrder!: number;
}

export class ReorderCatalogDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items!: ReorderItemDto[];
}

/**
 * Rejects reorder payloads that could corrupt the ordering: duplicate ids or
 * duplicate positions. Entity membership is checked against the database by the
 * calling service, inside the same request.
 */
export function assertUniqueReorderItems(items: ReorderItemDto[], label: string): void {
  const ids = new Set<string>();
  const positions = new Set<number>();

  for (const item of items) {
    if (ids.has(item.id)) {
      throw new BadRequestException(`Duplicate ${label} ids are not allowed`);
    }
    if (positions.has(item.displayOrder)) {
      throw new BadRequestException('Duplicate displayOrder values are not allowed');
    }
    ids.add(item.id);
    positions.add(item.displayOrder);
  }
}
