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

  async findOrCreateBuyer(params: { email: string; displayName?: string }): Promise<{ buyerId: string }> {
    try {
      // Search by externalIdentifier (we store email as the external identifier)
      const page = await this.jwtService.client.buyers.list({ externalIdentifier: params.email, limit: 1 });
      const first = page.result?.items?.[0];
      if (first?.id) {
        this.logger.log(`Found existing buyer ${first.id} for ${params.email}`);
        return { buyerId: first.id };
      }

      // Create a new buyer
      const buyer = await this.jwtService.client.buyers.create({
        externalIdentifier: params.email,
        displayName: params.displayName ?? params.email,
        billingDetails: { emailAddress: params.email },
      });
      if (!buyer.id) throw new Error('Buyer created but no ID returned');
      this.logger.log(`Created new buyer ${buyer.id} for ${params.email}`);
      return { buyerId: buyer.id };
    } catch (err) {
      this.logger.error('findOrCreateBuyer failed', err);
      throw new BadRequestException(this.sdkMessage(err));
    }
  }

  async createCheckoutToken(params: {
    amount: number;
    currency: string;
    userId?: string;
    buyerId?: string;
  }) {
    try {
      const session = await this.jwtService.client.checkoutSessions.create({
        amount: params.amount,
        currency: params.currency,
      });

      const token = await this.jwtService.generateEmbedToken({
        amount: params.amount,
        currency: params.currency,
        buyerId: params.buyerId,
        buyerExternalIdentifier: params.buyerId ? undefined : (params.userId ?? 'guest'),
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
        payByBank: data.items.filter((m) => ['pay-by-bank', 'open-banking', 'ideal', 'sofort', 'bancontact', 'eps', 'giropay', 'przelewy24'].includes(m.method)),
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

  /**
   * Records a payment that was processed outside of gr4vy (e.g. Stripe Link).
   * Saves to the orders table so it appears in your internal records alongside
   * gr4vy transactions. gr4vy has no external transaction API so this is
   * purely a local record.
   */
  async recordExternalTransaction(params: {
    externalTransactionId: string;
    externalPsp: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    userId?: string;
    buyerId?: string;
    status?: string;
  }): Promise<{ orderId: string }> {
    try {
      const order = await this.ordersRepo.save({
        userId: params.userId,
        amount: params.amount,
        currency: params.currency,
        paymentMethod: params.paymentMethod,
        paymentStatus: params.status ?? 'capture_succeeded',
        externalTransactionId: params.externalTransactionId,
        externalPsp: params.externalPsp,
      });
      this.logger.log(
        `Recorded external ${params.externalPsp} transaction ${params.externalTransactionId} as order ${order.id}`,
      );
      return { orderId: order.id };
    } catch (err) {
      this.logger.error('recordExternalTransaction failed', err);
      throw new BadRequestException(this.sdkMessage(err));
    }
  }

  async getPlaidLinkToken(): Promise<{ linkToken: string }> {
    try {
      // 'plaid-bank' is the fixed payment service definition ID per gr4vy docs
      const session = await this.jwtService.client.paymentServiceDefinitions.session(
        { action: 'create-link-token' },
        'plaid-bank',
      );
      const linkToken = session.responseBody?.['link_token'] as string | undefined;
      if (!linkToken) throw new Error('No link_token returned from Plaid session');
      return { linkToken };
    } catch (err) {
      this.logger.error('getPlaidLinkToken failed', err);
      throw new BadRequestException(this.sdkMessage(err));
    }
  }

  async getClickToPaySession(checkoutSessionId: string): Promise<unknown> {
    try {
      return await this.jwtService.client.digitalWallets.sessions.clickToPay({
        checkoutSessionId,
      });
    } catch (err) {
      this.logger.error('getClickToPaySession failed', err);
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
    userId?: string;
    buyerId?: string;
    intent?: string;
    paymentServiceId?: string;
  }) {
    try {
      const buyer = params.buyerId
        ? { id: params.buyerId }
        : { externalIdentifier: params.userId ?? 'guest' };

      // For Plaid transactions, inject the paymentServiceId from config.
      // gr4vy requires payment_service_id for all Plaid transactions.
      let resolvedPaymentServiceId = params.paymentServiceId;
      if (!resolvedPaymentServiceId && params.paymentMethod['method'] === 'plaid') {
        resolvedPaymentServiceId = this.config.get<string>('WIZLOPAY_PLAID_SERVICE_ID');
        if (!resolvedPaymentServiceId) {
          throw new BadRequestException(
            'WIZLOPAY_PLAID_SERVICE_ID is not set. Add the Plaid payment service UUID from your gr4vy Dashboard to apps/backend/.env.',
          );
        }
      }

      const transaction = await this.jwtService.client.transactions.create(
        {
          amount: params.amount,
          currency: params.currency,
          country: params.country,
          paymentMethod: params.paymentMethod as any,
          buyer: buyer as any,
          ...(params.intent && { intent: params.intent as any }),
          ...(resolvedPaymentServiceId && { paymentServiceId: resolvedPaymentServiceId }),
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
    userId?: string;
    buyerId?: string;
    cartItems?: { name: string; quantity: number; unitAmount: number }[];
  }) {
    try {
      const buyer = params.buyerId
        ? { id: params.buyerId }
        : { externalIdentifier: params.userId ?? 'guest' };

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
          buyer: buyer as any,
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
