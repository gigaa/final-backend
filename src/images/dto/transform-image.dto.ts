import {
  IsOptional,
  IsNumber,
  IsString,
  IsBoolean,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ImageFormat {
  JPEG = 'jpeg',
  PNG = 'png',
  WEBP = 'webp',
  AVIF = 'avif',
  GIF = 'gif',
}

export enum ImageFilter {
  GRAYSCALE = 'grayscale',
  SEPIA = 'sepia',
  BLUR = 'blur',
  SHARPEN = 'sharpen',
  NEGATE = 'negate',
}

export class TransformImageDto {
  // Resize
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  height?: number;

  // Crop (requires width & height + position)
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  crop?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cropLeft?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cropTop?: number;

  // Rotate
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rotate?: number;

  // Flip / Mirror
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  flip?: boolean; // vertical flip

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mirror?: boolean; // horizontal flip (flop)

  // Compress
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  quality?: number;

  // Format conversion
  @IsOptional()
  @IsEnum(ImageFormat)
  format?: ImageFormat;

  // Filter
  @IsOptional()
  @IsEnum(ImageFilter)
  filter?: ImageFilter;

  // Watermark text
  @IsOptional()
  @IsString()
  watermark?: string;
}
