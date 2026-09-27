import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ImageDocument = Image & Document;

@Schema({ timestamps: true })
export class Image {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  path: string;

  @Prop({ required: true })
  mimetype: string;

  @Prop({ required: true })
  size: number;

  @Prop({ default: 0 })
  width: number;

  @Prop({ default: 0 })
  height: number;

  @Prop({ default: 'original' })
  format: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const ImageSchema = SchemaFactory.createForClass(Image);
