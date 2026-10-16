import { LocalAssetStorageStrategy } from '@vendure/asset-server-plugin';
import { AssetStorageStrategy } from '@vendure/core';
import {
    UploadApiErrorResponse,
    UploadApiOptions,
    UploadApiResponse,
    v2 as cloudinary,
} from 'cloudinary';
import { Readable, Stream } from 'node:stream';

interface CloudinaryAssetStorageOptions {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    folder: string;
    localUploadPath: string;
    localAssetUrlPrefix: string;
}

export class CloudinaryAssetStorageStrategy implements AssetStorageStrategy {
    private readonly localStorage: LocalAssetStorageStrategy;
    private readonly folder: string;
    private readonly localAssetUrlPrefix: string;

    constructor(options: CloudinaryAssetStorageOptions) {
        this.folder = options.folder.replace(/^\/+|\/+$/g, '');
        this.localAssetUrlPrefix = `${options.localAssetUrlPrefix.replace(/\/+$/, '')}/`;
        this.localStorage = new LocalAssetStorageStrategy(options.localUploadPath);
        cloudinary.config({
            cloud_name: options.cloudName,
            api_key: options.apiKey,
            api_secret: options.apiSecret,
            secure: true,
        });
    }

    writeFileFromBuffer(fileName: string, data: Buffer): Promise<string> {
        return this.upload(fileName, uploadStream => uploadStream.end(data));
    }

    writeFileFromStream(fileName: string, data: Stream): Promise<string> {
        return this.upload(fileName, uploadStream => data.pipe(uploadStream));
    }

    async fileExists(fileName: string): Promise<boolean> {
        if (await this.localStorage.fileExists(fileName)) return true;
        try {
            const response = await fetch(this.deliveryUrl(fileName), { method: 'HEAD' });
            return response.ok;
        } catch {
            return false;
        }
    }

    async readFileToBuffer(identifier: string): Promise<Buffer> {
        if (!this.isRemoteIdentifier(identifier)) {
            return this.localStorage.readFileToBuffer(identifier);
        }
        const response = await fetch(identifier);
        if (!response.ok) throw new Error(`Cloudinary asset could not be read (${response.status})`);
        return Buffer.from(await response.arrayBuffer());
    }

    async readFileToStream(identifier: string, encoding?: BufferEncoding | null): Promise<Stream> {
        if (!this.isRemoteIdentifier(identifier)) {
            return this.localStorage.readFileToStream(identifier, encoding);
        }
        const stream = Readable.from(await this.readFileToBuffer(identifier));
        if (encoding) stream.setEncoding(encoding);
        return stream;
    }

    async deleteFile(identifier: string): Promise<void> {
        if (!this.isRemoteIdentifier(identifier)) {
            await this.localStorage.deleteFile(identifier);
            return;
        }
        const publicId = this.publicIdFromUrl(identifier);
        if (publicId) {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
        }
    }

    toAbsoluteUrl(_request: unknown, identifier: string): string {
        if (this.isRemoteIdentifier(identifier)) return identifier;
        return new URL(identifier.replace(/^\/+/, ''), this.localAssetUrlPrefix).toString();
    }

    private upload(fileName: string, write: (uploadStream: NodeJS.WritableStream) => void): Promise<string> {
        const options: UploadApiOptions = {
            public_id: this.publicId(fileName),
            resource_type: 'image',
            overwrite: false,
            unique_filename: false,
            use_filename: false,
        };
        return new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                options,
                (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
                    if (error) return reject(new Error(error.message));
                    if (!result?.secure_url) return reject(new Error('Cloudinary did not return an asset URL'));
                    resolve(result.secure_url);
                },
            );
            write(uploadStream);
        });
    }

    private publicId(fileName: string) {
        const normalized = fileName.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.[^/.]+$/, '');
        return this.folder ? `${this.folder}/${normalized}` : normalized;
    }

    private deliveryUrl(fileName: string) {
        const extension = fileName.match(/\.([^/.]+)$/)?.[1];
        return cloudinary.url(this.publicId(fileName), {
            secure: true,
            resource_type: 'image',
            format: extension,
        });
    }

    private isRemoteIdentifier(identifier: string) {
        return /^https?:\/\//i.test(identifier);
    }

    private publicIdFromUrl(identifier: string) {
        try {
            const pathName = new URL(identifier).pathname;
            const uploadPath = pathName.split('/image/upload/')[1];
            if (!uploadPath) return null;
            return decodeURIComponent(uploadPath.replace(/^v\d+\//, '')).replace(/\.[^/.]+$/, '');
        } catch {
            return null;
        }
    }
}
