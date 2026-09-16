import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Filesharer backend is running! Try GET /api/health or /api/files';
  }
}
