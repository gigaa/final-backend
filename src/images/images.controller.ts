import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ImagesService } from './images.service';
import { TransformImageDto } from './dto/transform-image.dto';
import { multerConfig } from './multer.config';

@UseGuards(JwtAuthGuard)
@Controller('images')
export class ImagesController {
  constructor(private imagesService: ImagesService) {}

  // POST /api/images/upload
  @Post('upload')
  @UseInterceptors(FileInterceptor('image', multerConfig))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    const image = await this.imagesService.upload(file, String(user._id));
    return { message: 'Image uploaded successfully', image };
  }

  // POST /api/images/:id/transform
  @Post(':id/transform')
  async transform(
    @Param('id') id: string,
    @Body() dto: TransformImageDto,
    @CurrentUser() user: any,
  ) {
    const image = await this.imagesService.transform(id, String(user._id), dto);
    return { message: 'Image transformed successfully', image };
  }

  // GET /api/images — paginated list with presigned URLs
  @Get()
  async findAll(
    @CurrentUser() user: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.imagesService.findAll(String(user._id), page, limit);
  }

  // GET /api/images/:id — metadata + presigned URL
  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.imagesService.findOne(id, String(user._id));
  }

  // GET /api/images/:id/download — stream file through backend (avoids S3 CORS)
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const image = await this.imagesService.findOne(id, String(user._id));
    const buffer = await this.imagesService.downloadBuffer(
      id,
      String(user._id),
    );

    res.setHeader('Content-Type', image.mimetype);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(image.originalName)}"`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  // DELETE /api/images/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser() user: any) {
    await this.imagesService.delete(id, String(user._id));
  }
}
