import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Friendship, FriendshipSchema } from '../schemas/friendship.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { FriendsService } from './friends.service';
import { FriendsController } from './friends.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Friendship.name, schema: FriendshipSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
