import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Real client IPs behind Render's reverse proxy (rate limiter keys off these)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(helmet());

  // Gzip JSON/metadata only — never file downloads or zips (already
  // compressed bytes would just burn the free instance's CPU for nothing).
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.path.includes('/download')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Allow any LAN origin for offline mode (phone on 192.168.x.x) + localhost for online
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // All routes prefixed: http://localhost:3001/api/...
  app.setGlobalPrefix('api');

  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://0.0.0.0:${port}/api`);
}
bootstrap();
