import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FilesModule } from './files/files.module';
import { SignalingModule } from './signaling/signaling.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    // Per-IP rate limits (in-memory; correct for a single instance).
    // Behind Render's proxy, real client IPs come from trust-proxy (main.ts).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),
    FilesModule,
    SignalingModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
