import { createReadStream } from 'node:fs';

import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { MarketplaceDigitalDownloadService } from '../services/marketplace-digital-download.service';

@Controller('marketplace-downloads')
export class MarketplaceDigitalDownloadController {
    constructor(private downloads: MarketplaceDigitalDownloadService) {}

    @Get(':token')
    async download(@Param('token') token: string, @Res() response: Response) {
        try {
            const { file, filePath } = await this.downloads.consumeGrant(token);
            const encodedName = encodeURIComponent(file.fileName)
                .replace(/'/g, '%27')
                .replace(/\(/g, '%28')
                .replace(/\)/g, '%29');
            response.status(200);
            response.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
            response.setHeader('Content-Length', String(file.sizeBytes));
            response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
            response.setHeader('Cache-Control', 'private, no-store, max-age=0');
            response.setHeader('X-Content-Type-Options', 'nosniff');
            createReadStream(filePath).pipe(response);
        } catch {
            response.status(404).json({ message: 'The download link is invalid, expired, or unavailable' });
        }
    }
}
