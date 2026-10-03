import { IsMongoId } from 'class-validator';

export class SendRequestDto {
  @IsMongoId()
  recipientId: string;
}
