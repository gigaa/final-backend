import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FriendshipDocument = Friendship & Document;

export enum FriendshipStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

@Schema({ timestamps: true })
export class Friendship {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requester: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipient: Types.ObjectId;

  @Prop({
    type: String,
    enum: FriendshipStatus,
    default: FriendshipStatus.PENDING,
  })
  status: FriendshipStatus;
}

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);

// Prevent duplicate friendship records between the same two users
FriendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
