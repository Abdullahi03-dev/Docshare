import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import * as os from 'os';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // GET /api -> health check
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // GET /api/health
  @Get('health')
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  // GET /api/network-info -> LAN IPs for offline mode (no internet needed)
  @Get('network-info')
  networkInfo() {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];
    for (const addrs of Object.values(interfaces)) {
      if (!addrs) continue;
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
      }
    }
    const port = Number(process.env.PORT || 3001);
    const frontendPort = Number(process.env.FRONTEND_PORT || 3000);
    return {
      ips,
      port,
      frontendPort,
      // hint URLs for QR when in local mode
      lanUrls: ips.map((ip) => `http://${ip}:${frontendPort}`),
      apiLanUrls: ips.map((ip) => `http://${ip}:${port}/api`),
    };
  }
}
