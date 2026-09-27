import { Injectable, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { S3Service } from '../s3/s3.service';
import { TransformImageDto, ImageFilter } from './dto/transform-image.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp');

export interface TransformResult {
  s3Key: string;
  mimetype: string;
  size: number;
  width: number;
  height: number;
  format: string;
}

@Injectable()
export class ImageTransformService {
  constructor(private s3: S3Service) {}

  async transform(
    sourceKey: string,
    dto: TransformImageDto,
  ): Promise<TransformResult> {
    // 1. Download original from S3 into a buffer
    const sourceBuffer = await this.s3.download(sourceKey);

    const outputFormat = dto.format ?? 'jpeg';
    const outputKey = `transformed/${uuidv4()}.${outputFormat}`;

    // 2. Build Sharp pipeline on the buffer
    let pipeline = sharp(sourceBuffer);

    if (dto.rotate !== undefined) {
      pipeline = pipeline.rotate(dto.rotate);
    }
    if (dto.flip) {
      pipeline = pipeline.flip();
    }
    if (dto.mirror) {
      pipeline = pipeline.flop();
    }

    if (dto.crop && dto.width && dto.height) {
      pipeline = pipeline.extract({
        left: dto.cropLeft ?? 0,
        top: dto.cropTop ?? 0,
        width: dto.width,
        height: dto.height,
      });
    } else if (dto.width || dto.height) {
      pipeline = pipeline.resize({
        width: dto.width,
        height: dto.height,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    if (dto.filter) {
      pipeline = this.applyFilter(pipeline, dto.filter);
    }

    if (dto.watermark) {
      pipeline = await this.applyWatermark(pipeline, dto.watermark);
    }

    pipeline = this.applyFormat(pipeline, outputFormat, dto.quality);

    // 3. Process to output buffer
    const { data: outputBuffer, info } = await pipeline.toBuffer({
      resolveWithObject: true,
    });

    const mimetype = `image/${info.format}`;

    // 4. Upload result buffer to S3
    await this.s3.upload(outputKey, outputBuffer, mimetype);

    return {
      s3Key: outputKey,
      mimetype,
      size: info.size,
      width: info.width,
      height: info.height,
      format: info.format,
    };
  }

  private applyFilter(pipeline: any, filter: ImageFilter): any {
    switch (filter) {
      case ImageFilter.GRAYSCALE:
        return pipeline.grayscale();
      case ImageFilter.SEPIA:
        return pipeline.recomb([
          [0.393, 0.769, 0.189],
          [0.349, 0.686, 0.168],
          [0.272, 0.534, 0.131],
        ]);
      case ImageFilter.BLUR:
        return pipeline.blur(3);
      case ImageFilter.SHARPEN:
        return pipeline.sharpen();
      case ImageFilter.NEGATE:
        return pipeline.negate();
      default:
        return pipeline;
    }
  }

  private async applyWatermark(pipeline: any, text: string): Promise<any> {
    const metadata = await pipeline.clone().metadata();
    const imgWidth = metadata.width ?? 400;
    const imgHeight = metadata.height ?? 300;
    const fontSize = Math.max(16, Math.floor(imgWidth / 20));
    const padding = Math.floor(fontSize * 0.8);

    const svgText = `
      <svg width="${imgWidth}" height="${imgHeight}">
        <style>
          .watermark {
            fill: rgba(255,255,255,0.55);
            font-size: ${fontSize}px;
            font-family: Arial, sans-serif;
            font-weight: bold;
          }
        </style>
        <text x="${imgWidth - padding}" y="${imgHeight - padding}"
          text-anchor="end" class="watermark">${text}</text>
      </svg>`;

    return pipeline.composite([
      { input: Buffer.from(svgText), top: 0, left: 0 },
    ]);
  }

  private applyFormat(pipeline: any, format: string, quality?: number): any {
    const q = quality ?? 85;
    switch (format) {
      case 'jpeg':
        return pipeline.jpeg({ quality: q });
      case 'png':
        return pipeline.png({ quality: q });
      case 'webp':
        return pipeline.webp({ quality: q });
      case 'avif':
        return pipeline.avif({ quality: q });
      case 'gif':
        return pipeline.gif();
      default:
        return pipeline.jpeg({ quality: q });
    }
  }
}
