import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Stripe = require('stripe');

@Injectable()
export class StripeCheckoutService {
  private readonly logger = new Logger(StripeCheckoutService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly stripe: any;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(secretKey);
  }

  /**
   * Creates a PaymentIntent for use with the Stripe Express Checkout Element (Link-only).
   * Called server-side when the user confirms payment in the Link flow.
   */
  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    customerEmail?: string;
  }): Promise<{ clientSecret: string }> {
    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        // Let Stripe decide payment methods automatically (Link will be included)
        automatic_payment_methods: { enabled: true },
        ...(params.customerEmail && { receipt_email: params.customerEmail }),
      });

      if (!intent.client_secret) throw new Error('No client_secret returned');
      this.logger.log(`PaymentIntent created: ${intent.id}`);
      return { clientSecret: intent.client_secret };
    } catch (err) {
      this.logger.error('createPaymentIntent failed', err);
      throw new BadRequestException(err instanceof Error ? err.message : 'Stripe error');
    }
  }
}
