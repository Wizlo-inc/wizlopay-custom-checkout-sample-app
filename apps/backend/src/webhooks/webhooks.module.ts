import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhooksController } from './webhooks.controller';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { ProcessedWebhook } from './entities/processed-webhook.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order, User, ProcessedWebhook])],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
