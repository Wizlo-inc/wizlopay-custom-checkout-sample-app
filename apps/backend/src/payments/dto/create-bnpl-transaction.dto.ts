import { IsEnum, IsNumber, IsString, IsArray, IsOptional, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

class CartItemDto {
  @IsString()
  name: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitAmount: number;
}

export class CreateBnplTransactionDto {
  @IsString()
  @IsOptional()
  buyerId?: string;


  @IsEnum(['klarna', 'affirm'])
  method: 'klarna' | 'affirm';

  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  country: string;

  @IsString()
  checkoutSessionId: string;

  @IsString()
  redirectUrl: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  cartItems?: CartItemDto[];
}
