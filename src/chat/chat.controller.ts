import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChatService } from './chat.service';

const chatImageMulter = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
};

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) {}

  // POST /api/chat/:friendId/messages — REST fallback for text messages
  @Post(':friendId/messages')
  async sendTextMessage(
    @Param('friendId') friendId: string,
    @Body() body: { content: string },
    @CurrentUser() user: any,
  ) {
    const msg = await this.chatService.saveTextMessage(
      String(user._id),
      friendId,
      body.content ?? '',
    );
    return msg;
  }

  // GET /api/chat/:friendId/messages — paginated history
  @Get(':friendId/messages')
  async history(
    @Param('friendId') friendId: string,
    @CurrentUser() user: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
  ) {
    return this.chatService.getConversation(
      String(user._id),
      friendId,
      page,
      limit,
    );
  }

  // POST /api/chat/:friendId/images — upload chat image, returns message + presigned URL
  @Post(':friendId/images')
  @UseInterceptors(FileInterceptor('image', chatImageMulter))
  async uploadImage(
    @Param('friendId') friendId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    return this.chatService.saveImageMessage(
      String(user._id),
      friendId,
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }

  // POST /api/chat/:friendId/read — mark messages as read
  @Post(':friendId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @Param('friendId') friendId: string,
    @CurrentUser() user: any,
  ) {
    await this.chatService.markAsRead(String(user._id), friendId);
  }

  // GET /api/chat/unread — unread counts per conversation
  @Get('unread')
  async unread(@CurrentUser() user: any) {
    return this.chatService.getUnreadCounts(String(user._id));
  }

  // GET /api/chat/messages/:messageId/download — proxy S3 image through backend
  @Get('messages/:messageId/download')
  async downloadImage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { buffer, mimetype, originalName } =
      await this.chatService.downloadChatImage(messageId, String(user._id));

    res.setHeader('Content-Type', mimetype);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(originalName)}"`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  // DELETE /api/chat/messages/:messageId — delete a single message
  @Delete('messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: any,
  ) {
    await this.chatService.deleteMessage(messageId, String(user._id));
  }

  // PATCH /api/chat/messages/:messageId — edit text content of a message
  @Patch('messages/:messageId')
  async editMessage(
    @Param('messageId') messageId: string,
    @Body() body: { content: string },
    @CurrentUser() user: any,
  ) {
    return this.chatService.editMessage(
      messageId,
      String(user._id),
      body.content ?? '',
    );
  }

  // DELETE /api/chat/:friendId/conversation — delete entire conversation
  @Delete(':friendId/conversation')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(
    @Param('friendId') friendId: string,
    @CurrentUser() user: any,
  ) {
    await this.chatService.deleteConversation(String(user._id), friendId);
  }
}
