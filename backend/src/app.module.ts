import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FilesModule } from './files/files.module';
import { SignalingModule } from './signaling/signaling.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [FilesModule, SignalingModule, MailModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
