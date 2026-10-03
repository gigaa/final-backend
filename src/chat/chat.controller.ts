import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
}
