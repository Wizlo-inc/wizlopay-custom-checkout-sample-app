import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from './jwt.service';
import { Order } from '../orders/entities/order.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
  ) {}

  async createCheckoutToken(params: {
    amount: number;
    currency: string;
    userId: string;
  }) {
    try {
      const session = await this.jwtService.client.checkoutSessions.create({
        amount: params.amount,
        currency: params.currency,
      });

      const token = await this.jwtService.generateEmbedToken({
        amount: params.amount,
        currency: params.currency,
        buyerExternalIdentifier: params.userId,
        checkoutSessionId: session.id,
      });

      return { token, checkoutSessionId: session.id };
    } catch (err) {
      this.logger.error('createCheckoutToken failed', err);
      throw new BadRequestException(this.sdkMessage(err));
    }
  }

  async listPaymentOptions(params: { amount: number; currency: string; country: string }) {
    try {
      const data = await this.jwtService.client.paymentOptions.list({
        amount: params.amount,
        currency: params.currency,
        country: params.country,
      });

      this.logger.log(`Payment options returned: ${data.items.map((m) => m.method).join(', ')}`);

      return {
        payNow: data.items.filter((m) => ['card', 'applepay', 'googlepay'].includes(m.method)),
        payLater: data.items.filter((m) => ['klarna', 'affirm'].includes(m.method)),
      };
    } catch (err) {
      this.logger.error('listPaymentOptions failed', err);
      throw new BadRequestException(this.sdkMessage(err));
    }
  }

  async getApplePaySession(validationUrl: string): Promise<unknown> {
    try {
      return await this.jwtService.client.digitalWallets.sessions.applePay({
        validationUrl,
        domainName: this.config.getOrThrow('APP_DOMAIN'),
      });
    } catch (err) {
      this.logger.error('getApplePaySession failed', err);
      throw new BadRequestException(this.sdkMessage(err));
    }
  }

  async getGooglePaySession(domain: string): Promise<unknown> {
    try {
      return await this.jwtService.client.digitalWallets.sessions.googlePay({
        originDomain: domain,
      });
    } catch (err) {
      this.logger.error('getGooglePaySession failed', err);
      throw new BadRequestException(this.sdkMessage(err));
    }
  }

  async createTransaction(params: {
    amount: number;
    currency: string;
    country: string;
    paymentMethod: Record<string, unknown>;
    checkoutSessionId?: string;
    redirectUrl?: string;
    userId: string;
  }) {
    try {
      const transaction = await this.jwtService.client.transactions.create(
        {
          amount: params.amount,
          currency: params.currency,
          country: params.country,
          paymentMethod: params.paymentMethod as any,
          buyer: { externalIdentifier: params.userId },
        },
      );

      await this.ordersRepo.save({
        userId: params.userId,
        amount: params.amount,
        currency: params.currency,
        wizlopayTransactionId: transaction.id,
        wizlopayCheckoutSessionId: params.checkoutSessionId,
        paymentStatus: 'pending',
        paymentMethod: String(params.paymentMethod['method'] ?? 'card'),
      });

      return { transactionId: transaction.id, status: transaction.status };
    } catch (err) {
      this.logger.error('createTransaction failed', err);
      throw new BadRequestException(this.sdkMessage(err));
    }
  }

  async createBnplTransaction(params: {
    method: 'klarna' | 'affirm';
    amount: number;
    currency: string;
    country: string;
    checkoutSessionId: string;
    redirectUrl: string;
    userId: string;
    cartItems?: { name: string; quantity: number; unitAmount: number }[];
  }) {
    try {
      const transaction = await this.jwtService.client.transactions.create(
        {
          amount: params.amount,
          currency: params.currency,
          country: params.country,
          paymentMethod: {
            method: params.method,
            redirectUrl: params.redirectUrl,
            country: params.country,
            currency: params.currency,
          } as any,
          buyer: { externalIdentifier: params.userId },
          ...(params.cartItems?.length && {
            cartItems: params.cartItems.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              unitAmount: i.unitAmount,
            })),
          }),
        },
      );

      const approvalUrl =
        (transaction as any).approvalUrl ??
        (transaction as any).paymentMethod?.approvalUrl;

      await this.ordersRepo.save({
        userId: params.userId,
        amount: params.amount,
        currency: params.currency,
        wizlopayTransactionId: transaction.id,
        wizlopayCheckoutSessionId: params.checkoutSessionId,
        paymentStatus: 'pending',
        paymentMethod: params.method,
      });

      return { transactionId: transaction.id, approvalUrl };
    } catch (err) {
      this.logger.error('createBnplTransaction failed', err);
      throw new BadRequestException(this.sdkMessage(err));
    }
  }

  private sdkMessage(err: unknown): string {
    if (err instanceof Error) {
      const body = (err as any).body;
      if (body) {
        try {
          const parsed = typeof body === 'string' ? JSON.parse(body) : body;
          const details = parsed?.details?.map((d: any) => d.message ?? JSON.stringify(d)).join('; ');
          if (details) return `${err.message}: ${details}`;
        } catch { /* ignore parse errors */ }
      }
      return err.message;
    }
    return 'WizloPay API error';
  }
}

export interface PaymentOption {
  method: string;
  label: string;
  icon_url: string;
  mode: string;
}
