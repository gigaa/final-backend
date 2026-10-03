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
import { forwardRef, Inject } from '@nestjs/common';
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
    @Inject(forwardRef(() => ChatService))
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
        .select('_id name email isEmailVerified');
      if (!user || !user.isEmailVerified) throw new Error('Unauthorized');

      (client as AuthenticatedSocket).userId = String(user._id);
      (client as AuthenticatedSocket).userName =
        (user as any).name ?? (user as any).email ?? '';

      const uid = String(user._id);
      if (!this.onlineUsers.has(uid)) {
        this.onlineUsers.set(uid, new Set());
      }
      this.onlineUsers.get(uid)!.add(client.id);

      // Join personal room for targeted delivery
      void client.join(`user:${uid}`);

      // Broadcast online status
      this.server.emit('user:online', { userId: uid });

      // Send full online list to the newly connected client
      client.emit('users:online', {
        users: Array.from(this.onlineUsers.keys()),
      });
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

  // ── Emit helpers (called by ChatService) ─────────────────

  /** Push a chat event to both participants */
  sendToUsers(
    userIdA: string,
    userIdB: string,
    event: string,
    payload: object,
  ) {
    this.server.to(`user:${userIdA}`).emit(event, payload);
    this.server.to(`user:${userIdB}`).emit(event, payload);
  }

  /** Push an event to a single user (all their tabs) */
  sendToUser(userId: string, event: string, payload: object) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  // ── WebSocket event handlers ──────────────────────────────

  /** Client sends a text message via WebSocket */
  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { recipientId: string; content: string },
  ) {
    const { recipientId, content } = data;
    if (!recipientId || !content?.trim()) {
      throw new WsException('recipientId and content are required');
    }

    await this.chatService.saveTextMessage(
      client.userId,
      recipientId,
      content.trim(),
    );
    // ChatService calls gateway.sendToUsers — no extra emit needed here
  }

  /** Client marks messages from a conversation as read */
  @SubscribeMessage('message:read')
  async handleMarkRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { friendId: string },
  ) {
    await this.chatService.markAsRead(client.userId, data.friendId);
  }

  /** Client asks for the current online users list */
  @SubscribeMessage('users:online')
  handleGetOnline(@ConnectedSocket() client: AuthenticatedSocket) {
    client.emit('users:online', { users: Array.from(this.onlineUsers.keys()) });
  }

  // ── Public helpers ────────────────────────────────────────

  isOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }
}
