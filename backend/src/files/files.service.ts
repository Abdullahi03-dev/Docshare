import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface StoredFile {
  id: string;
  originalName: string;
  storedName: string;
  size: number;
  mimetype: string;
  path: string;
  uploadedAt: string;
}

export interface ShareSession {
  code: string;
  files: StoredFile[];
  expiresAt: Date;
  timer: NodeJS.Timeout;
  /** chosen TTL in minutes (whitelisted) */
  ttlMinutes: number;
  /** burn-after-reading: whole session is deleted after first completed download */
  burn: boolean;
}

export interface CreateSessionOptions {
  ttlMinutes?: number;
  burn?: boolean;
}

/** Allowed share lifetimes in minutes. Anything else falls back to default. */
export const ALLOWED_TTLS = [10, 30, 60, 1440];
export const DEFAULT_TTL = 30;

@Injectable()
export class FilesService implements OnModuleDestroy {
  private uploadDir = path.join(process.cwd(), 'uploads');
  private sessions = new Map<string, ShareSession>();
  private sweepInterval: NodeJS.Timeout;
  private readonly SWEEP_MS = 60 * 1000; // 60s

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    // sweep every 60s for crash recovery / missed timeouts
    this.sweepInterval = setInterval(() => this.sweepExpired(), this.SWEEP_MS);
    // don't keep process alive just for sweep
    if (this.sweepInterval.unref) this.sweepInterval.unref();
  }

  onModuleDestroy() {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    for (const s of this.sessions.values()) clearTimeout(s.timer);
  }

  // ---- code gen ----
  private generateCode(): string {
    // 1000-9999 inclusive, 9000 pool, no dup while active
    let code: string;
    let attempts = 0;
    do {
      code = String(Math.floor(1000 + Math.random() * 9000));
      attempts++;
      if (attempts > 9000) throw new Error('No available share codes (pool exhausted)');
    } while (this.sessions.has(code));
    return code;
  }

  createSession(
    files: Express.Multer.File[],
    opts: CreateSessionOptions = {},
  ): { code: string; session: ShareSession } {
    const code = this.generateCode();
    const storedFiles: StoredFile[] = files.map((f) => ({
      id: f.filename.split('.')[0],
      originalName: f.originalname,
      storedName: f.filename,
      size: f.size,
      mimetype: f.mimetype,
      path: f.path,
      uploadedAt: new Date().toISOString(),
    }));

    const ttlMinutes = ALLOWED_TTLS.includes(Number(opts.ttlMinutes))
      ? Number(opts.ttlMinutes)
      : DEFAULT_TTL;
    const expiryMs = ttlMinutes * 60 * 1000;
    const burn = opts.burn === true;

    const expiresAt = new Date(Date.now() + expiryMs);
    const timer = setTimeout(() => this.cleanup(code), expiryMs);
    if (timer.unref) timer.unref();

    const session: ShareSession = {
      code,
      files: storedFiles,
      expiresAt,
      timer,
      ttlMinutes,
      burn,
    };
    this.sessions.set(code, session);
    return { code, session };
  }

  getSession(code: string): ShareSession | undefined {
    return this.sessions.get(code);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      code: s.code,
      files: s.files,
      expiresAt: s.expiresAt,
      ttlMinutes: s.ttlMinutes,
      burn: s.burn,
    }));
  }

  // legacy single-file list helper (kept for compat if needed)
  list(): StoredFile[] {
    if (!fs.existsSync(this.uploadDir)) return [];
    return fs.readdirSync(this.uploadDir).map((storedName) => {
      const full = path.join(this.uploadDir, storedName);
      const stat = fs.statSync(full);
      return {
        id: storedName.split('.')[0],
        originalName: storedName,
        storedName,
        size: stat.size,
        mimetype: 'application/octet-stream',
        path: full,
        uploadedAt: stat.birthtime.toISOString(),
      };
    });
  }

  resolvePath(storedName: string): string {
    return path.join(this.uploadDir, path.basename(storedName));
  }

  remove(storedName: string): boolean {
    const full = this.resolvePath(storedName);
    if (!fs.existsSync(full)) return false;
    fs.unlinkSync(full);
    return true;
  }

  cleanup(code: string): boolean {
    const session = this.sessions.get(code);
    if (!session) return false;
    clearTimeout(session.timer);
    for (const f of session.files) {
      try {
        const full = this.resolvePath(f.storedName);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      } catch {
        // ignore unlink errors
      }
    }
    this.sessions.delete(code);
    return true;
  }

  private sweepExpired() {
    const now = Date.now();
    for (const [code, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() <= now) {
        this.cleanup(code);
      }
    }
  }

  // single-file helper kept for backwards compat
  saveRecord(file: Express.Multer.File): StoredFile {
    return {
      id: file.filename.split('.')[0],
      originalName: file.originalname,
      storedName: file.filename,
      size: file.size,
      mimetype: file.mimetype,
      path: file.path,
      uploadedAt: new Date().toISOString(),
    };
  }
}
