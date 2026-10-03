import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Friendship,
  FriendshipDocument,
  FriendshipStatus,
} from '../schemas/friendship.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { SendRequestDto } from './dto/send-request.dto';
import { RespondRequestDto } from './dto/respond-request.dto';

@Injectable()
export class FriendsService {
  constructor(
    @InjectModel(Friendship.name)
    private friendshipModel: Model<FriendshipDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /** Search users by name or email (excludes the caller themselves) */
  async searchUsers(query: string, currentUserId: string) {
    const regex = new RegExp(query, 'i');
    const users = await this.userModel
      .find({
        _id: { $ne: new Types.ObjectId(currentUserId) },
        isEmailVerified: true,
        $or: [{ name: regex }, { email: regex }],
      })
      .select('_id name email')
      .limit(20)
      .lean();

    // Attach friendship status for each result
    const withStatus = await Promise.all(
      users.map(async (u) => {
        const friendship = await this.friendshipModel
          .findOne({
            $or: [
              {
                requester: new Types.ObjectId(currentUserId),
                recipient: u._id,
              },
              {
                requester: u._id,
                recipient: new Types.ObjectId(currentUserId),
              },
            ],
          })
          .lean();

        let friendshipStatus: string | null = null;
        let friendshipId: string | null = null;
        let iAmRequester = false;

        if (friendship) {
          friendshipStatus = friendship.status;
          friendshipId = String(friendship._id);
          iAmRequester =
            String(friendship.requester) === currentUserId;
        }

        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          friendshipStatus,
          friendshipId,
          iAmRequester,
        };
      }),
    );

    return withStatus;
  }

  /** Send a friend request */
  async sendRequest(dto: SendRequestDto, requesterId: string) {
    if (dto.recipientId === requesterId) {
      throw new BadRequestException('Cannot send a friend request to yourself');
    }

    const recipient = await this.userModel.findById(dto.recipientId);
    if (!recipient) throw new NotFoundException('User not found');

    const existing = await this.friendshipModel.findOne({
      $or: [
        {
          requester: new Types.ObjectId(requesterId),
          recipient: new Types.ObjectId(dto.recipientId),
        },
        {
          requester: new Types.ObjectId(dto.recipientId),
          recipient: new Types.ObjectId(requesterId),
        },
      ],
    });

    if (existing) {
      if (existing.status === FriendshipStatus.ACCEPTED) {
        throw new ConflictException('Already friends');
      }
      if (existing.status === FriendshipStatus.PENDING) {
        throw new ConflictException('Friend request already sent');
      }
      // Rejected — allow re-sending by updating the existing record
      existing.requester = new Types.ObjectId(requesterId);
      existing.recipient = new Types.ObjectId(dto.recipientId);
      existing.status = FriendshipStatus.PENDING;
      await existing.save();
      return existing;
    }

    return this.friendshipModel.create({
      requester: new Types.ObjectId(requesterId),
      recipient: new Types.ObjectId(dto.recipientId),
      status: FriendshipStatus.PENDING,
    });
  }

  /** Accept or reject a pending request */
  async respondToRequest(
    friendshipId: string,
    dto: RespondRequestDto,
    currentUserId: string,
  ) {
    const friendship = await this.friendshipModel.findById(friendshipId);
    if (!friendship) throw new NotFoundException('Friend request not found');

    if (String(friendship.recipient) !== currentUserId) {
      throw new ForbiddenException(
        'Only the recipient can respond to this request',
      );
    }

    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new BadRequestException('Request is no longer pending');
    }

    friendship.status = dto.status;
    await friendship.save();
    return friendship;
  }

  /** List all accepted friends for the current user */
  async listFriends(userId: string) {
    const friendships = await this.friendshipModel
      .find({
        $or: [
          {
            requester: new Types.ObjectId(userId),
            status: FriendshipStatus.ACCEPTED,
          },
          {
            recipient: new Types.ObjectId(userId),
            status: FriendshipStatus.ACCEPTED,
          },
        ],
      })
      .populate('requester', 'name email')
      .populate('recipient', 'name email')
      .lean();

    return friendships.map((f) => {
      const friend =
        String((f.requester as any)._id) === userId
          ? f.recipient
          : f.requester;
      return { friendshipId: String(f._id), friend };
    });
  }

  /** List pending requests received by the current user */
  async listPendingReceived(userId: string) {
    return this.friendshipModel
      .find({
        recipient: new Types.ObjectId(userId),
        status: FriendshipStatus.PENDING,
      })
      .populate('requester', 'name email')
      .lean();
  }

  /** List pending requests sent by the current user */
  async listPendingSent(userId: string) {
    return this.friendshipModel
      .find({
        requester: new Types.ObjectId(userId),
        status: FriendshipStatus.PENDING,
      })
      .populate('recipient', 'name email')
      .lean();
  }

  /** Remove a friend (delete the accepted friendship record) */
  async removeFriend(friendshipId: string, userId: string) {
    const friendship = await this.friendshipModel.findById(friendshipId);
    if (!friendship) throw new NotFoundException('Friendship not found');

    const isParty =
      String(friendship.requester) === userId ||
      String(friendship.recipient) === userId;
    if (!isParty) throw new ForbiddenException('Access denied');

    await this.friendshipModel.findByIdAndDelete(friendshipId);
  }

  /** Verify two users are friends — used by ChatGateway */
  async areFriends(userIdA: string, userIdB: string): Promise<boolean> {
    const f = await this.friendshipModel.findOne({
      $or: [
        {
          requester: new Types.ObjectId(userIdA),
          recipient: new Types.ObjectId(userIdB),
          status: FriendshipStatus.ACCEPTED,
        },
        {
          requester: new Types.ObjectId(userIdB),
          recipient: new Types.ObjectId(userIdA),
          status: FriendshipStatus.ACCEPTED,
        },
      ],
    });
    return !!f;
  }
}
