import { IsEmail, IsOptional, IsString } from 'class-validator';

export class FindOrCreateBuyerDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  displayName?: string;
}
