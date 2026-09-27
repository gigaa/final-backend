import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Image, ImageDocument } from '../schemas/image.schema';
import { ImageTransformService } from './image-transform.service';
import { S3Service } from '../s3/s3.service';
import { TransformImageDto } from './dto/transform-image.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp');

@Injectable()
export class ImagesService {
  constructor(
    @InjectModel(Image.name) private imageModel: Model<ImageDocument>,
    private transformService: ImageTransformService,
    private s3: S3Service,
  ) {}

  async upload(
    file: Express.Multer.File,
    userId: string,
  ): Promise<ImageDocument & { url: string }> {
    // Read image metadata from in-memory buffer
    const metadata = await sharp(file.buffer).metadata();

    // Build a unique S3 key: originals/<uuid>.<ext>
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const s3Key = `originals/${uuidv4()}${ext}`;

    // Upload buffer to S3
    await this.s3.upload(s3Key, file.buffer, file.mimetype);

    const image = await this.imageModel.create({
      userId: new Types.ObjectId(userId),
      originalName: file.originalname,
      filename: s3Key, // store S3 key as filename
      path: s3Key, // path = S3 key (no local path)
      mimetype: file.mimetype,
      size: file.size,
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: metadata.format ?? 'unknown',
    });

    const url = await this.s3.getPresignedUrl(s3Key);
    return Object.assign(image.toObject(), { url }) as any;
  }

  async transform(
    imageId: string,
    userId: string,
    dto: TransformImageDto,
  ): Promise<ImageDocument & { url: string }> {
    const original = await this.findOneOwned(imageId, userId);

    const result = await this.transformService.transform(original.path, dto);

    const image = await this.imageModel.create({
      userId: new Types.ObjectId(userId),
      originalName: original.originalName,
      filename: result.s3Key,
      path: result.s3Key,
      mimetype: result.mimetype,
      size: result.size,
      width: result.width,
      height: result.height,
      format: result.format,
      metadata: { transformedFrom: imageId, transformations: dto },
    });

    const url = await this.s3.getPresignedUrl(result.s3Key);
    return Object.assign(image.toObject(), { url }) as any;
  }

  async findAll(
    userId: string,
    page = 1,
    limit = 10,
  ): Promise<{ data: any[]; total: number; page: number; pages: number }> {
    const skip = (page - 1) * limit;
    const query = { userId: new Types.ObjectId(userId) };

    const [docs, total] = await Promise.all([
      this.imageModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.imageModel.countDocuments(query),
    ]);

    // Attach a presigned URL to every image
    const data = await Promise.all(
      docs.map(async (doc) => {
        const url = await this.s3.getPresignedUrl(doc.path);
        return Object.assign(doc.toObject(), { url });
      }),
    );

    return { data, total, page, pages: Math.ceil(total / limit) };
  }

  async findOne(
    imageId: string,
    userId: string,
  ): Promise<ImageDocument & { url: string }> {
    const image = await this.findOneOwned(imageId, userId);
    const url = await this.s3.getPresignedUrl(image.path);
    return Object.assign(image.toObject(), { url }) as any;
  }

  async delete(imageId: string, userId: string): Promise<void> {
    const image = await this.findOneOwned(imageId, userId);
    await this.s3.delete(image.path);
    await this.imageModel.findByIdAndDelete(image._id);
  }

  // Returns a presigned download URL for streaming (used by download endpoint)
  async getDownloadUrl(imageId: string, userId: string): Promise<string> {
    const image = await this.findOneOwned(imageId, userId);
    return this.s3.getPresignedUrl(image.path, 300); // 5-min URL
  }

  // Downloads raw buffer from S3 — used by the download endpoint to avoid CORS
  async downloadBuffer(imageId: string, userId: string): Promise<Buffer> {
    const image = await this.findOneOwned(imageId, userId);
    return this.s3.download(image.path);
  }

  private async findOneOwned(
    imageId: string,
    userId: string,
  ): Promise<ImageDocument> {
    if (!Types.ObjectId.isValid(imageId)) {
      throw new NotFoundException('Invalid image ID');
    }
    const image = await this.imageModel.findById(imageId);
    if (!image) throw new NotFoundException('Image not found');
    if (image.userId.toString() !== userId)
      throw new ForbiddenException('Access denied');
    return image;
  }
}
