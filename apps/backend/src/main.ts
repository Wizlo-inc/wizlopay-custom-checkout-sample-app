import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, raw } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  // Raw body for webhook signature verification — must come before json middleware
  app.use('/webhooks/wizlopay', raw({ type: 'application/json' }));
  app.use(json());

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  await app.listen(process.env.APP_PORT ?? 4000);
  console.log(`Backend running on http://localhost:${process.env.APP_PORT ?? 4000}`);
}

bootstrap();
