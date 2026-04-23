import {
  Controller,
  Post,
  Body,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreateTokenDto } from './dto/create-token.dto';
import { PaymentOptionsDto } from './dto/payment-options.dto';
import { CreateBnplTransactionDto } from './dto/create-bnpl-transaction.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';

// Simple user extraction — replace with your real auth guard in production
function extractUserId(authHeader?: string): string {
  // For sandbox: pass userId in Authorization header as "User <uuid>"
  // In production, use a proper JWT guard and extract from req.user
  if (authHeader?.startsWith('User ')) return authHeader.slice(5);
  return 'guest-' + Math.random().toString(36).slice(2, 9);
}

@Controller('checkout')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('token')
  async getToken(
    @Body() body: CreateTokenDto,
    @Headers('authorization') auth?: string,
  ) {
    const userId = body.userId ?? extractUserId(auth);
    return this.paymentsService.createCheckoutToken({
      amount: body.amount,
      currency: body.currency,
      userId,
    });
  }

  @Post('payment-options')
  async getPaymentOptions(@Body() body: PaymentOptionsDto) {
    return this.paymentsService.listPaymentOptions(body);
  }

  @Post('apple-session')
  async applePaySession(@Body() body: { validationUrl: string }) {
    if (!body.validationUrl) throw new BadRequestException('validationUrl required');
    return this.paymentsService.getApplePaySession(body.validationUrl);
  }

  @Post('google-session')
  async googlePaySession(@Body() body: { domain: string }) {
    if (!body.domain) throw new BadRequestException('domain required');
    let bodyDomain = 'https://www.app.wizlo.com'
    return this.paymentsService.getGooglePaySession(bodyDomain);
  }

  @Post('transaction')
  async createTransaction(
    @Body() body: CreateTransactionDto,
    @Headers('authorization') auth?: string,
  ) {
    const userId = extractUserId(auth);
    return this.paymentsService.createTransaction({ ...body, userId });
  }

  @Post('bnpl')
  async createBnplTransaction(
    @Body() body: CreateBnplTransactionDto,
    @Headers('authorization') auth?: string,
  ) {
    const userId = extractUserId(auth);
    return this.paymentsService.createBnplTransaction({ ...body, userId });
  }
}
