import { IsNumber, IsString, IsObject, Min, IsOptional } from 'class-validator';

export class CreateTransactionDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  country: string;

  @IsObject()
  paymentMethod: Record<string, unknown>;

  @IsString()
  @IsOptional()
  checkoutSessionId?: string;

  @IsString()
  @IsOptional()
  redirectUrl?: string;
}
