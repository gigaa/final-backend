import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { User, UserDocument } from '../schemas/user.schema';

interface AuthenticatedSocket extends Socket {
  userId: string;
  userName: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CLIENT_URL || '*',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  /** userId → Set of socket IDs (a user can have multiple tabs) */
  private onlineUsers = new Map<string, Set<string>>();

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private configService: ConfigService,
  ) {}

  // ── Connection lifecycle ──────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace(
          'Bearer ',
          '',
        );

      if (!token) throw new Error('No token');

      const payload = this.jwtService.verify<{ sub: string; email: string }>(
        token,
        { secret: this.configService.get<string>('JWT_SECRET') },
      );

      const user = await this.userModel
        .findById(payload.sub)
        .select('_id name isEmailVerified');
      if (!user || !user.isEmailVerified) throw new Error('Unauthorized');

      (client as AuthenticatedSocket).userId = String(user._id);
      (client as AuthenticatedSocket).userName = user.name ?? user.email ?? '';

      // Track online status
      const uid = String(user._id);
      if (!this.onlineUsers.has(uid)) {
        this.onlineUsers.set(uid, new Set());
      }
      this.onlineUsers.get(uid)!.add(client.id);

      // Join a personal room so we can send targeted events
      client.join(`user:${uid}`);

      // Broadcast online status to all connected clients
      this.server.emit('user:online', { userId: uid });

      // Send the full online list to the newly connected client
      const onlineList = Array.from(this.onlineUsers.keys());
      client.emit('users:online', { users: onlineList });
    } catch {
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const uid = (client as AuthenticatedSocket).userId;
    if (!uid) return;

    const sockets = this.onlineUsers.get(uid);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.onlineUsers.delete(uid);
        this.server.emit('user:offline', { userId: uid });
      }
    }
  }

  // ── Events ───────────────────────────────────────────────

  /** Client sends a text message */
  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { recipientId: string; content: string },
  ) {
    const { recipientId, content } = data;

    if (!recipientId || !content?.trim()) {
      throw new WsException('recipientId and content are required');
    }

    const msg = await this.chatService.saveTextMessage(
      client.userId,
      recipientId,
      content.trim(),
    );

    const payload = {
      _id: String((msg as any)._id),
      sender: client.userId,
      recipient: recipientId,
      type: 'text',
      content: msg.content,
      read: false,
      createdAt: (msg as any).createdAt,
    };

    // Deliver to recipient (all their tabs) and echo back to sender
    this.server.to(`user:${recipientId}`).emit('message:receive', payload);
    this.server.to(`user:${client.userId}`).emit('message:receive', payload);
  }

  /** Client sends a notification after uploading an image via REST */
  @SubscribeMessage('message:image')
  async handleImageMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      recipientId: string;
      messageId: string;
      imageUrl: string;
      imageOriginalName: string;
    },
  ) {
    const { recipientId, messageId, imageUrl, imageOriginalName } = data;

    if (!recipientId || !messageId) {
      throw new WsException('recipientId and messageId are required');
    }

    const payload = {
      _id: messageId,
      sender: client.userId,
      recipient: recipientId,
      type: 'image',
      content: '',
      imageUrl,
      imageOriginalName,
      read: false,
      createdAt: new Date().toISOString(),
    };

    this.server.to(`user:${recipientId}`).emit('message:receive', payload);
    this.server.to(`user:${client.userId}`).emit('message:receive', payload);
  }

  /** Client marks messages from a conversation as read */
  @SubscribeMessage('message:read')
  async handleMarkRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { friendId: string },
  ) {
    await this.chatService.markAsRead(client.userId, data.friendId);
    // Notify the friend that their messages were read
    this.server
      .to(`user:${data.friendId}`)
      .emit('message:read', { by: client.userId });
  }

  /** Client asks for the current online users list */
  @SubscribeMessage('users:online')
  handleGetOnline(@ConnectedSocket() client: AuthenticatedSocket) {
    const onlineList = Array.from(this.onlineUsers.keys());
    client.emit('users:online', { users: onlineList });
  }

  // ── Public helper used by other services if needed ───────

  isOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }
}
