import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FilesModule } from './files/files.module';
import { SignalingModule } from './signaling/signaling.module';

@Module({
  imports: [FilesModule, SignalingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
