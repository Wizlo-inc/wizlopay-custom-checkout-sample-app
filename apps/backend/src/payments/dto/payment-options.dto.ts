import { IsNumber, IsString, Min } from 'class-validator';

export class PaymentOptionsDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  country: string;
}
