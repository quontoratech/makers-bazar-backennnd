import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';

import { Injectable } from '@nestjs/common';

import { MarketplaceDigitalFile } from '../entities/marketplace-digital-file.entity';

const allowedExtensions = new Set([
    'pdf',
    'zip',
    'svg',
    'png',
    'jpg',
    'jpeg',
    'docx',
    'xlsx',
    'pptx',
    'mp4',
    'mp3',
    'txt',
    'json',
]);

export interface DigitalFileInspection {
    integrityStatus: 'VALID' | 'INVALID' | 'UNAVAILABLE';
    scanStatus: 'CLEAN' | 'REJECTED' | 'UNAVAILABLE';
    message?: string;
}

@Injectable()
export class DigitalFileSecurityService {
    async inspect(file: MarketplaceDigitalFile): Promise<DigitalFileInspection> {
        try {
            const filePath = this.privateFilePath(file.storageKey);
            const fileStat = await stat(filePath);
            if (!fileStat.isFile() || fileStat.size !== file.sizeBytes) {
                return this.invalid('The private file size no longer matches its verified upload metadata');
            }
            if (!(await this.hasValidSignature(filePath, file.fileName))) {
                return this.invalid('The private file content does not match its extension');
            }
            const digest = await this.sha256(filePath);
            if (!file.checksum || digest !== file.checksum) {
                return this.invalid('The private file checksum no longer matches its verified upload');
            }
            return {
                integrityStatus: 'VALID',
                scanStatus: file.metadata?.onboardingId
                    ? file.scanStatus === 'CLEAN'
                        ? 'CLEAN'
                        : file.scanStatus === 'REJECTED'
                          ? 'REJECTED'
                          : 'UNAVAILABLE'
                    : 'CLEAN',
            };
        } catch (error) {
            return this.invalid(
                error instanceof Error ? error.message : 'The private file could not be inspected',
            );
        }
    }

    async resolveDownloadPath(file: MarketplaceDigitalFile) {
        const filePath = this.privateFilePath(file.storageKey);
        const fileStat = await stat(filePath);
        if (!fileStat.isFile() || fileStat.size !== file.sizeBytes) {
            throw new Error('The private file size no longer matches its verified upload metadata');
        }
        if (!(await this.hasValidSignature(filePath, file.fileName))) {
            throw new Error('The private file content does not match its extension');
        }
        const digest = await this.sha256(filePath);
        if (!file.checksum || digest !== file.checksum) {
            throw new Error('The private file checksum no longer matches its verified upload');
        }
        return filePath;
    }

    private privateFilePath(storageKey: string) {
        const configuredRoot = process.env.PRIVATE_DIGITAL_ASSET_DIR?.trim();
        const localRoot = process.cwd().endsWith(`${path.sep}apps${path.sep}api`)
            ? path.resolve(process.cwd(), '../web/private-digital-assets')
            : path.resolve(process.cwd(), 'private-digital-assets');
        const root = path.resolve(configuredRoot || localRoot);
        const filePath = path.resolve(root, storageKey);
        if (!storageKey || !filePath.startsWith(`${root}${path.sep}`)) {
            throw new Error('The private file storage key is invalid');
        }
        return filePath;
    }

    private async sha256(filePath: string) {
        const handle = await open(filePath, 'r');
        const hash = createHash('sha256');
        try {
            for await (const chunk of handle.createReadStream()) hash.update(chunk);
            return hash.digest('hex');
        } finally {
            await handle.close().catch(() => undefined);
        }
    }

    private async hasValidSignature(filePath: string, fileName: string) {
        const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
        if (!allowedExtensions.has(extension)) return false;
        const handle = await open(filePath, 'r');
        try {
            const header = Buffer.alloc(4096);
            const { bytesRead } = await handle.read(header, 0, header.length, 0);
            const bytes = header.subarray(0, bytesRead);
            if (extension === 'pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
            if (['zip', 'docx', 'xlsx', 'pptx'].includes(extension))
                return bytes[0] === 0x50 && bytes[1] === 0x4b;
            if (extension === 'png')
                return bytes
                    .subarray(0, 8)
                    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
            if (extension === 'jpg' || extension === 'jpeg') {
                const fileStat = await handle.stat();
                if (fileStat.size < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
                const footer = Buffer.alloc(2);
                await handle.read(footer, 0, 2, fileStat.size - 2);
                return footer[0] === 0xff && footer[1] === 0xd9;
            }
            if (extension === 'mp3')
                return (
                    bytes.subarray(0, 3).toString() === 'ID3' ||
                    (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
                );
            if (extension === 'mp4') return bytes.subarray(4, 8).toString() === 'ftyp';
            if (extension === 'svg') return /<svg[\s>]/i.test(bytes.toString('utf8'));
            return true;
        } finally {
            await handle.close().catch(() => undefined);
        }
    }

    private invalid(message: string): DigitalFileInspection {
        return { integrityStatus: 'INVALID', scanStatus: 'UNAVAILABLE', message };
    }
}
