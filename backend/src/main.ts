import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow any LAN origin for offline mode (phone on 192.168.x.x) + localhost for online
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // All routes prefixed: http://localhost:3001/api/...
  app.setGlobalPrefix('api');

  const port = Number(process.env.PORT || 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://0.0.0.0:${port}/api`);
}
bootstrap();
