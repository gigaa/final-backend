import { IsEnum } from 'class-validator';
import { FriendshipStatus } from '../../schemas/friendship.schema';

export class RespondRequestDto {
  @IsEnum([FriendshipStatus.ACCEPTED, FriendshipStatus.REJECTED])
  status: FriendshipStatus.ACCEPTED | FriendshipStatus.REJECTED;
}
