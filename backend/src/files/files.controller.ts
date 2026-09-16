import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, createReadStream, statSync } from 'fs';
import { randomUUID } from 'crypto';
import * as archiverModule from 'archiver';
const archiver = (archiverModule as any).default ?? archiverModule;
import { FilesService } from './files.service';

// Multer: stream straight to disk (fast, low RAM, any file type)
const storage = diskStorage({
  destination: join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${extname(file.originalname)}`);
  },
});

@Controller()
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // POST /api/share  (FormData files[] -> multi-file)
  @Post('share')
  @UseInterceptors(
    FilesInterceptor('files', 50, {
      storage,
      limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB per file
    }),
  )
  share(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) throw new NotFoundException('No files received');
    const { code, session } = this.filesService.createSession(files);
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return {
      code,
      qr: `${baseUrl}/r/${code}`,
      files: session.files.map((f) => ({
        originalName: f.originalName,
        storedName: f.storedName,
        size: f.size,
        mimetype: f.mimetype,
      })),
      expiresAt: session.expiresAt,
    };
  }

  // GET /api/share -> list active codes (admin/debug)
  @Get('share')
  listShares() {
    return this.filesService.listSessions();
  }

  // GET /api/share/:code -> metadata (phone checks what's available)
  @Get('share/:code')
  getShare(@Param('code') code: string) {
    const session = this.filesService.getSession(code);
    if (!session) throw new NotFoundException('Share not found or expired');
    return {
      code: session.code,
      files: session.files.map((f) => ({
        originalName: f.originalName,
        storedName: f.storedName,
        size: f.size,
        mimetype: f.mimetype,
      })),
      expiresAt: session.expiresAt,
    };
  }

  // GET /api/share/:code/download -> stream back
  // single file: direct stream; multi-file: zip on-the-fly (no temp file)
  @Get('share/:code/download')
  download(@Param('code') code: string, @Res() res: Response) {
    const session = this.filesService.getSession(code);
    if (!session) throw new NotFoundException('Share not found or expired');
    if (session.files.length === 0) throw new NotFoundException('No files in share');

    if (session.files.length === 1) {
      const f = session.files[0];
      const full = this.filesService.resolvePath(f.storedName);
      if (!existsSync(full)) throw new NotFoundException('File not found on disk');
      const stat = statSync(full);
      res.set({
        'Content-Length': String(stat.size),
        'Content-Type': f.mimetype || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(f.originalName)}"`,
      });
      const stream = createReadStream(full);
      // if client disconnects, destroy stream
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      });
      return;
    }

    // multi-file -> zip stream
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="share-${code}.zip"`,
    });
    const archive = archiver('zip', { zlib: { level: 1 } }); // level 1 = fastest

    // kill archive if client disconnects mid-download
    res.on('close', () => {
      try {
        archive.abort();
      } catch {}
    });

    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ message: err.message });
      else res.destroy();
    });

    archive.pipe(res);

    for (const f of session.files) {
      const full = this.filesService.resolvePath(f.storedName);
      if (existsSync(full)) {
        archive.append(createReadStream(full), { name: f.originalName });
      }
    }

    archive.finalize();
  }

  // GET /api/share/:code/download/:index -> download single file from multi-share
  @Get('share/:code/download/:index')
  downloadOne(@Param('code') code: string, @Param('index') index: string, @Res() res: Response) {
    const session = this.filesService.getSession(code);
    if (!session) throw new NotFoundException('Share not found or expired');
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= session.files.length)
      throw new NotFoundException('File index out of range');
    const f = session.files[idx];
    const full = this.filesService.resolvePath(f.storedName);
    if (!existsSync(full)) throw new NotFoundException('File not found on disk');
    const stat = statSync(full);
    res.set({
      'Content-Length': String(stat.size),
      'Content-Type': f.mimetype || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(f.originalName)}"`,
    });
    const stream = createReadStream(full);
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  // DELETE /api/share/:code -> kill session (fs unlink + Map.delete + abort downloading streams)
  @Delete('share/:code')
  kill(@Param('code') code: string) {
    const ok = this.filesService.cleanup(code);
    if (!ok) throw new NotFoundException('Share not found or already expired');
    return { deleted: true, code };
  }

  // ---- legacy compat routes (keep so old frontend doesn't break) ----

  // POST /api/files/upload  (single file, legacy)
  @Post('files/upload')
  @UseInterceptors(FilesInterceptor('files', 1, { storage, limits: { fileSize: 1024 * 1024 * 1024 } }))
  uploadLegacy(@UploadedFiles() files: Express.Multer.File[]) {
    const file = files?.[0];
    if (!file) throw new NotFoundException('No file received');
    const { code, session } = this.filesService.createSession([file]);
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return {
      id: session.files[0].id,
      originalName: session.files[0].originalName,
      storedName: session.files[0].storedName,
      size: session.files[0].size,
      mimetype: session.files[0].mimetype,
      path: session.files[0].path,
      uploadedAt: session.files[0].uploadedAt,
      code,
      qr: `${baseUrl}/r/${code}`,
      expiresAt: session.expiresAt,
    };
  }

  @Get('files')
  listLegacy() {
    return this.filesService.list();
  }

  @Get('files/:name/download')
  downloadLegacy(@Param('name') name: string, @Res() res: Response) {
    const full = this.filesService.resolvePath(name);
    if (!existsSync(full)) throw new NotFoundException('File not found');
    const stat = statSync(full);
    res.set({
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    const stream = createReadStream(full);
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  @Delete('files/:name')
  removeLegacy(@Param('name') name: string) {
    const ok = this.filesService.remove(name);
    if (!ok) throw new NotFoundException('File not found');
    return { deleted: true, name };
  }
}
