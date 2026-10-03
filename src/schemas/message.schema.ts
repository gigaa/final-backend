import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MessageDocument = Message & Document;

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
}

@Schema({ timestamps: true })
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sender: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipient: Types.ObjectId;

  @Prop({ type: String, enum: MessageType, default: MessageType.TEXT })
  type: MessageType;

  /** Plain text content — present when type === 'text' */
  @Prop({ type: String, default: '' })
  content: string;

  /** S3 key of the uploaded image — present when type === 'image' */
  @Prop({ type: String, default: null })
  imageKey: string | null;

  /** Original filename of the uploaded image */
  @Prop({ type: String, default: null })
  imageOriginalName: string | null;

  @Prop({ default: false })
  read: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Index for fast conversation queries (both directions)
MessageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });
MessageSchema.index({ recipient: 1, read: 1 });
