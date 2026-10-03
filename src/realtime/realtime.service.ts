import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Apinator } from '@apinator/server';

/** Channel naming helpers — must match the frontend */
export function dmChannel(userIdA: string, userIdB: string): string {
  // Sort so the channel name is the same regardless of who initiates
  const [a, b] = [userIdA, userIdB].sort();
  return `private-dm-${a}--${b}`;
}

export function userChannel(userId: string): string {
  return `private-user-${userId}`;
}

@Injectable()
export class RealtimeService implements OnModuleInit {
  private client: Apinator;
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.client = new Apinator({
      appId: this.config.get<string>('APINATOR_APP_ID')!,
      key: this.config.get<string>('APINATOR_KEY')!,
      secret: this.config.get<string>('APINATOR_SECRET')!,
      cluster: this.config.get<string>('APINATOR_CLUSTER', 'eu') as 'eu' | 'us',
    });
    this.logger.log('Apinator realtime service initialized');
  }

  /** Trigger an event on a channel */
  async trigger(channel: string, event: string, data: object): Promise<void> {
    try {
      await this.client.trigger({ channel, name: event, data: JSON.stringify(data) });
    } catch (err) {
      this.logger.error(`Apinator trigger failed [${channel}/${event}]`, err);
    }
  }

  /** Send a chat message to both participants' DM channel */
  async sendChatMessage(
    senderId: string,
    recipientId: string,
    payload: object,
  ): Promise<void> {
    const channel = dmChannel(senderId, recipientId);
    await this.trigger(channel, 'message:receive', payload);
  }

  /** Notify a specific user on their private channel */
  async notifyUser(userId: string, event: string, payload: object): Promise<void> {
    await this.trigger(userChannel(userId), event, payload);
  }
}
