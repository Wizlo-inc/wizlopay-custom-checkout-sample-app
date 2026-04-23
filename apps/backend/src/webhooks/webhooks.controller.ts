import {
  Controller,
  Post,
  Req,
  Res,
  Headers,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request, Response } from 'express';
import { verifyWebhook } from '@gr4vy/sdk';
import { ConfigService } from '@nestjs/config';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { ProcessedWebhook } from './entities/processed-webhook.entity';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Order) private readonly ordersRepo: Repository<Order>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(ProcessedWebhook)
    private readonly processedRepo: Repository<ProcessedWebhook>,
  ) {}

  @Post('wizlopay')
  async handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
    @Headers('x-gr4vy-webhook-signatures') signaturesHeader: string,
    @Headers('x-gr4vy-webhook-timestamp') timestampHeader: string,
    @Headers('x-gr4vy-webhook-id') webhookId: string,
  ) {
    res.status(200).send('OK');

    const rawBody = req.rawBody?.toString() ?? '';

    try {
      verifyWebhook(
        rawBody,
        this.config.getOrThrow('WIZLOPAY_WEBHOOK_SECRET'),
        signaturesHeader,
        timestampHeader,
        300,
      );
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${(err as Error).message}`);
      return;
    }

    if (await this.processedRepo.findOne({ where: { webhookId } })) return;
    await this.processedRepo.save({ webhookId });

    let event: { type: string; data: Record<string, string> };
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      return;
    }

    setImmediate(() => this.process(event).catch((e: Error) => this.logger.error(e)));
  }

  private async process(event: { type: string; data: Record<string, string> }) {
    switch (event.type) {
      case 'transaction.capture.succeeded':
        await this.ordersRepo.update(
          { wizlopayTransactionId: event.data['id'] },
          { paymentStatus: 'paid' },
        );
        this.logger.log(`Payment confirmed for transaction ${event.data['id']}`);
        break;

      case 'transaction.capture.declined':
      case 'transaction.capture.failed':
        await this.ordersRepo.update(
          { wizlopayTransactionId: event.data['id'] },
          { paymentStatus: 'failed' },
        );
        break;

      case 'buyer.created':
        if (event.data['external_identifier']) {
          await this.usersRepo.update(
            { id: event.data['external_identifier'] },
            { wizlopayBuyerId: event.data['id'] },
          );
          this.logger.log(`Stored WizloPay buyer ID for user ${event.data['external_identifier']}`);
        }
        break;

      default:
        this.logger.debug(`Unhandled webhook type: ${event.type}`);
    }
  }
}
