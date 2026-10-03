import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { FriendsService } from './friends.service';
import { SendRequestDto } from './dto/send-request.dto';
import { RespondRequestDto } from './dto/respond-request.dto';

@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private friendsService: FriendsService) {}

  // GET /api/friends/search?q=...
  @Get('search')
  async search(@Query('q') q: string, @CurrentUser() user: any) {
    return this.friendsService.searchUsers(q ?? '', String(user._id));
  }

  // GET /api/friends — accepted friends list
  @Get()
  async listFriends(@CurrentUser() user: any) {
    return this.friendsService.listFriends(String(user._id));
  }

  // GET /api/friends/requests/received — incoming pending requests
  @Get('requests/received')
  async pendingReceived(@CurrentUser() user: any) {
    return this.friendsService.listPendingReceived(String(user._id));
  }

  // GET /api/friends/requests/sent — outgoing pending requests
  @Get('requests/sent')
  async pendingSent(@CurrentUser() user: any) {
    return this.friendsService.listPendingSent(String(user._id));
  }

  // POST /api/friends/request — send a friend request
  @Post('request')
  async sendRequest(@Body() dto: SendRequestDto, @CurrentUser() user: any) {
    return this.friendsService.sendRequest(dto, String(user._id));
  }

  // PATCH /api/friends/request/:id — accept or reject
  @Patch('request/:id')
  async respond(
    @Param('id') id: string,
    @Body() dto: RespondRequestDto,
    @CurrentUser() user: any,
  ) {
    return this.friendsService.respondToRequest(id, dto, String(user._id));
  }

  // DELETE /api/friends/:id — remove friend
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFriend(@Param('id') id: string, @CurrentUser() user: any) {
    await this.friendsService.removeFriend(id, String(user._id));
  }
}
