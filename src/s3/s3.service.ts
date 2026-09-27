import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Readable } from 'stream';

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private config: ConfigService) {
    this.bucket = this.config.get<string>('AWS_S3_BUCKET', 'pixelforge-images');
    this.region = this.config.get<string>('AWS_REGION', 'eu-north-1');

    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    const sessionToken = this.config.get<string>('AWS_SESSION_TOKEN');

    this.client = new S3Client({
      region: this.region,
      // If static keys are provided (e.g. on Render/Vercel), use them directly.
      // Otherwise fall back to the local provider chain (dev machine with SSO).
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
              ...(sessionToken ? { sessionToken } : {}),
            }
          : fromNodeProviderChain({
              profile: this.config.get<string>('AWS_PROFILE', 'pixelforge'),
            }),
    });
  }

  // Upload a buffer or stream to S3
  async upload(
    key: string,
    body: Buffer | Readable,
    contentType: string,
  ): Promise<string> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return key;
    } catch (err) {
      console.error('S3 upload error:', err);
      throw new InternalServerErrorException('Failed to upload file to S3');
    }
  }

  // Delete an object from S3
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      console.error('S3 delete error:', err);
    }
  }

  // Get a presigned URL valid for 1 hour (for serving images to frontend)
  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  // Download an S3 object as a Buffer (for Sharp processing)
  async download(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const stream = response.Body as Readable;
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (err) {
      console.error('S3 download error:', err);
      throw new InternalServerErrorException('Failed to download file from S3');
    }
  }

  getBucket(): string {
    return this.bucket;
  }

  getRegion(): string {
    return this.region;
  }
}
