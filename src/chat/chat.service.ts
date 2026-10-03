import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  Message,
  MessageDocument,
  MessageType,
} from '../schemas/message.schema';
import { FriendsService } from '../friends/friends.service';
import { S3Service } from '../s3/s3.service';
import { ChatGateway } from './chat.gateway';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    private friendsService: FriendsService,
    private s3: S3Service,
    @Inject(forwardRef(() => ChatGateway))
    private gateway: ChatGateway,
  ) {}

  /** Save a text message and push it via WebSocket */
  async saveTextMessage(
    senderId: string,
    recipientId: string,
    content: string,
  ): Promise<MessageDocument> {
    await this.assertFriends(senderId, recipientId);

    const msg = await this.messageModel.create({
      sender: new Types.ObjectId(senderId),
      recipient: new Types.ObjectId(recipientId),
      type: MessageType.TEXT,
      content,
    });

    const payload = this.buildTextPayload(msg, senderId, recipientId);
    this.gateway.sendToUsers(senderId, recipientId, 'message:receive', payload);

    return msg;
  }

  /** Upload image to S3, save the message, push via WebSocket */
  async saveImageMessage(
    senderId: string,
    recipientId: string,
    fileBuffer: Buffer,
    mimetype: string,
    originalName: string,
  ): Promise<MessageDocument & { imageUrl: string }> {
    await this.assertFriends(senderId, recipientId);

    const ext = originalName.split('.').pop() ?? 'jpg';
    const s3Key = `chat-images/${uuidv4()}.${ext}`;
    await this.s3.upload(s3Key, fileBuffer, mimetype);

    const msg = await this.messageModel.create({
      sender: new Types.ObjectId(senderId),
      recipient: new Types.ObjectId(recipientId),
      type: MessageType.IMAGE,
      content: '',
      imageKey: s3Key,
      imageOriginalName: originalName,
    });

    const imageUrl = await this.s3.getPresignedUrl(s3Key);

    const payload = {
      _id: String((msg as any)._id),
      sender: senderId,
      recipient: recipientId,
      type: 'image' as const,
      content: '',
      imageUrl,
      imageOriginalName: originalName,
      read: false,
      createdAt: (msg as any).createdAt,
    };

    this.gateway.sendToUsers(senderId, recipientId, 'message:receive', payload);

    return Object.assign(msg.toObject(), { imageUrl }) as any;
  }

  /** Paginated conversation history */
  async getConversation(
    userId: string,
    friendId: string,
    page = 1,
    limit = 30,
  ) {
    await this.assertFriends(userId, friendId);

    const skip = (page - 1) * limit;
    const query = {
      $or: [
        {
          sender: new Types.ObjectId(userId),
          recipient: new Types.ObjectId(friendId),
        },
        {
          sender: new Types.ObjectId(friendId),
          recipient: new Types.ObjectId(userId),
        },
      ],
    };

    const [docs, total] = await Promise.all([
      this.messageModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.messageModel.countDocuments(query),
    ]);

    const messages = await Promise.all(
      docs.map(async (m) => {
        if (m.type === MessageType.IMAGE && m.imageKey) {
          const imageUrl = await this.s3.getPresignedUrl(m.imageKey);
          return { ...m, imageUrl };
        }
        return m;
      }),
    );

    return {
      messages: messages.reverse(),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  /** Mark all messages from friendId → userId as read, push read receipt */
  async markAsRead(userId: string, friendId: string) {
    await this.messageModel.updateMany(
      {
        sender: new Types.ObjectId(friendId),
        recipient: new Types.ObjectId(userId),
        read: false,
      },
      { $set: { read: true } },
    );

    // Notify the sender that their messages were read
    this.gateway.sendToUser(friendId, 'message:read', { by: userId });
  }

  /** Unread counts per conversation */
  async getUnreadCounts(userId: string): Promise<Record<string, number>> {
    const results = await this.messageModel.aggregate([
      { $match: { recipient: new Types.ObjectId(userId), read: false } },
      { $group: { _id: '$sender', count: { $sum: 1 } } },
    ]);
    return results.reduce(
      (acc, r) => {
        acc[String(r._id)] = r.count;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  /** Delete a single message — only the sender can delete */
  async deleteMessage(messageId: string, requesterId: string): Promise<void> {
    const msg = await this.messageModel.findById(messageId);
    if (!msg) throw new NotFoundException('Message not found');
    if (String(msg.sender) !== requesterId)
      throw new ForbiddenException('Only the sender can delete a message');

    // If image message, also remove from S3
    if (msg.type === MessageType.IMAGE && msg.imageKey) {
      await this.s3.delete(msg.imageKey).catch(() => {});
    }

    await this.messageModel.deleteOne({ _id: msg._id });

    const senderId = String(msg.sender);
    const recipientId = String(msg.recipient);
    this.gateway.sendToUsers(senderId, recipientId, 'message:deleted', {
      messageId,
      conversationWith: recipientId,
    });
  }

  /** Edit a text message — only the sender can edit, images cannot be edited */
  async editMessage(
    messageId: string,
    requesterId: string,
    content: string,
  ): Promise<MessageDocument> {
    const msg = await this.messageModel.findById(messageId);
    if (!msg) throw new NotFoundException('Message not found');
    if (String(msg.sender) !== requesterId)
      throw new ForbiddenException('Only the sender can edit a message');
    if (msg.type !== MessageType.TEXT)
      throw new ForbiddenException('Only text messages can be edited');

    msg.content = content.trim();
    (msg as any).edited = true;
    await msg.save();

    const senderId = String(msg.sender);
    const recipientId = String(msg.recipient);
    this.gateway.sendToUsers(senderId, recipientId, 'message:edited', {
      messageId,
      content: msg.content,
    });

    return msg;
  }

  /** Delete entire conversation between two users */
  async deleteConversation(userId: string, friendId: string): Promise<void> {
    await this.assertFriends(userId, friendId);

    // Collect image keys to delete from S3
    const imageMsgs = await this.messageModel
      .find({
        $or: [
          {
            sender: new Types.ObjectId(userId),
            recipient: new Types.ObjectId(friendId),
          },
          {
            sender: new Types.ObjectId(friendId),
            recipient: new Types.ObjectId(userId),
          },
        ],
        type: MessageType.IMAGE,
        imageKey: { $ne: null },
      })
      .lean();

    await Promise.all(
      imageMsgs.map((m) => this.s3.delete(m.imageKey!).catch(() => {})),
    );

    await this.messageModel.deleteMany({
      $or: [
        {
          sender: new Types.ObjectId(userId),
          recipient: new Types.ObjectId(friendId),
        },
        {
          sender: new Types.ObjectId(friendId),
          recipient: new Types.ObjectId(userId),
        },
      ],
    });

    this.gateway.sendToUsers(userId, friendId, 'conversation:deleted', {
      between: [userId, friendId],
    });
  }

  /** Download a chat image — proxied through backend to avoid S3 CORS */
  async downloadChatImage(
    messageId: string,
    requesterId: string,
  ): Promise<{ buffer: Buffer; mimetype: string; originalName: string }> {
    const msg = await this.messageModel.findById(messageId);
    if (!msg || msg.type !== MessageType.IMAGE || !msg.imageKey) {
      throw new ForbiddenException('Image not found');
    }
    const isParty =
      String(msg.sender) === requesterId ||
      String(msg.recipient) === requesterId;
    if (!isParty) throw new ForbiddenException('Access denied');

    const buffer = await this.s3.download(msg.imageKey);
    return {
      buffer,
      mimetype: 'application/octet-stream',
      originalName: msg.imageOriginalName ?? 'image',
    };
  }

  private buildTextPayload(msg: any, senderId: string, recipientId: string) {
    return {
      _id: String(msg._id),
      sender: senderId,
      recipient: recipientId,
      type: 'text' as const,
      content: msg.content,
      read: false,
      createdAt: msg.createdAt,
    };
  }

  private async assertFriends(userA: string, userB: string) {
    const ok = await this.friendsService.areFriends(userA, userB);
    if (!ok)
      throw new ForbiddenException('You can only chat with your friends');
  }
}
