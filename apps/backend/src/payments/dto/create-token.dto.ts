import { IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class CreateTokenDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  @IsOptional()
  userId?: string;
}
