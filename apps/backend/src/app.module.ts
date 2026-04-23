import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsModule } from './payments/payments.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { User } from './users/entities/user.entity';
import { Order } from './orders/entities/order.entity';
import { ProcessedWebhook } from './webhooks/entities/processed-webhook.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [User, Order, ProcessedWebhook],
        synchronize: true, // disable in production — use migrations instead
        logging: config.get('NODE_ENV') !== 'production',
      }),
    }),
    PaymentsModule,
    WebhooksModule,
  ],
})
export class AppModule {}
