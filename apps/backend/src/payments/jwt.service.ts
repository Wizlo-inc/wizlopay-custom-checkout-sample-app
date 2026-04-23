import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gr4vy } from '@gr4vy/sdk';
import { getToken, getEmbedToken, withToken, JWTScope } from '@gr4vy/sdk';

@Injectable()
export class JwtService implements OnModuleInit {
  private readonly logger = new Logger(JwtService.name);
  private privateKey!: string;
  private readonly instanceId: string;
  private readonly environment: 'sandbox' | 'production';
  private readonly merchantAccountId: string;

  client!: Gr4vy;

  constructor(private readonly config: ConfigService) {
    this.instanceId = this.config.getOrThrow('WIZLOPAY_INSTANCE_ID');
    this.environment = (this.config.get('WIZLOPAY_ENVIRONMENT', 'sandbox')) as 'sandbox' | 'production';
    this.merchantAccountId = this.config.get('WIZLOPAY_MERCHANT_ACCOUNT_ID', 'default');
  }

  async onModuleInit() {
    this.privateKey = this.config
      .getOrThrow<string>('WIZLOPAY_PRIVATE_KEY')
      .replace(/\\n/g, '\n')        // handle escaped \n in single-line .env values
      .split('\n')
      .map((line) => line.trim())   // strip indentation that breaks PEM parsing
      .join('\n')
      .trim();

    this.client = new Gr4vy({
      id: this.instanceId,
      server: this.environment,
      merchantAccountId: this.merchantAccountId,
      bearerAuth: withToken({
        privateKey: this.privateKey,
        scopes: [JWTScope.ReadAll, JWTScope.WriteAll],
      }),
    });

    this.logger.log(
      `WizloPay SDK initialized — instance: ${this.instanceId}, env: ${this.environment}, merchant: ${this.merchantAccountId}`,
    );
  }

  /** Short-lived token passed to the browser for Secure Fields / checkout */
  async generateEmbedToken(params: {
    amount: number;
    currency: string;
    buyerExternalIdentifier: string;
    checkoutSessionId?: string;
  }): Promise<string> {
    return getEmbedToken({
      privateKey: this.privateKey,
      embedParams: {
        amount: params.amount,
        currency: params.currency,
        buyerExternalIdentifier: params.buyerExternalIdentifier,
      },
      checkoutSessionId: params.checkoutSessionId,
    });
  }

  /** Server-side token for direct API calls — used internally only */
  async generateServerToken(scopes: JWTScope[] = [JWTScope.ReadAll, JWTScope.WriteAll]): Promise<string> {
    return getToken({ privateKey: this.privateKey, scopes });
  }
}
