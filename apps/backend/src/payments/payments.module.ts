import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { JwtService } from './jwt.service';
import { StripeCheckoutService } from './stripe.checkout.service';
import { Order } from '../orders/entities/order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [PaymentsController],
  providers: [PaymentsService, JwtService, StripeCheckoutService],
  exports: [JwtService],
})
export class PaymentsModule {}
