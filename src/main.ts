import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Global API prefix
  app.setGlobalPrefix('api');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: false,
      transform: true, // auto-transform query params to proper types
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Serve uploaded images as static files at /uploads/*
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });

  // CORS
  const clientUrl = process.env.CLIENT_URL || '*';
  app.enableCors({
    origin: clientUrl,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Socket.io adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}/api`);
  console.log(`🔌 WebSocket gateway available at ws://localhost:${port}/chat`);
}

bootstrap();
