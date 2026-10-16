import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import {
    DefaultJobQueuePlugin,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    LanguageCode,
    VendureConfig,
} from '@vendure/core';
import { defaultEmailHandlers, EmailPlugin } from '@vendure/email-plugin';
import { GraphiqlPlugin } from '@vendure/graphiql-plugin';
import 'dotenv/config';
import path from 'node:path';

import { CloudinaryAssetStorageStrategy } from './cloudinary-asset-storage.strategy';
import { marketplaceEmailHandlers } from '../email/marketplace-email-handlers';
import { MarketplaceTemplateLoader } from '../email/marketplace-template-loader';
import { MarketplacePlugin } from '../plugins/marketplace/marketplace.plugin';

const isDevelopment = process.env.APP_ENV !== 'production';
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3001';
const apiPort = Number(process.env.API_PORT ?? 3000);
const apiPublicUrl = (process.env.API_PUBLIC_URL ?? `http://localhost:${apiPort}`).replace(/\/+$/, '');

export const config: VendureConfig = {
    apiOptions: {
        port: apiPort,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        adminApiDebug: isDevelopment,
        shopApiDebug: isDevelopment,
        cors: {
            origin: [webOrigin],
            credentials: true,
        },
    },
    authOptions: {
        requireVerification: true,
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: process.env.SUPERADMIN_USERNAME ?? 'superadmin',
            password: process.env.SUPERADMIN_PASSWORD ?? 'superadmin',
        },
        cookieOptions: {
            secret: process.env.COOKIE_SECRET ?? 'local-development-secret',
        },
    },
    assetOptions: {
        uploadMaxFileSize: 100 * 1024 * 1024,
    },
    dbConnectionOptions: getDatabaseConfig(),
    defaultLanguageCode: LanguageCode.en,
    paymentOptions: {
        paymentMethodHandlers: [],
    },
    customFields: {},
    plugins: [
        ...(isDevelopment ? [GraphiqlPlugin.init()] : []),
        createAssetServerPlugin(),
        DefaultSchedulerPlugin.init(),
        DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        createEmailPlugin(),
        MarketplacePlugin.init({
            defaultCommissionPercent: 10,
            platformFeeSKU: 'MARKETPLACE-FEE',
            payoutHoldDays: 7,
        }),
    ],
};

function createAssetServerPlugin() {
    const assetUploadDir = path.join(__dirname, '../../assets');
    const credentials = {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
        apiKey: process.env.CLOUDINARY_API_KEY ?? '',
        apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
    };
    const suppliedCount = Object.values(credentials).filter(Boolean).length;
    if (suppliedCount > 0 && suppliedCount < 3) {
        throw new Error('Cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET');
    }
    return AssetServerPlugin.init({
        route: 'assets',
        assetUploadDir,
        assetUrlPrefix: `${apiPublicUrl}/assets/`,
        ...(suppliedCount === 3 ? {
            storageStrategyFactory: () => new CloudinaryAssetStorageStrategy({
                ...credentials,
                folder: process.env.CLOUDINARY_FOLDER ?? 'marketsquare',
                localUploadPath: assetUploadDir,
                localAssetUrlPrefix: `${apiPublicUrl}/assets/`,
            }),
        } : {}),
    });
}

function createEmailPlugin() {
    const handlers = [
        ...defaultEmailHandlers.filter(handler =>
            handler.type !== 'email-verification' && handler.type !== 'order-confirmation',
        ),
        ...marketplaceEmailHandlers,
    ];
    const commonOptions = {
        handlers,
        templateLoader: new MarketplaceTemplateLoader(
            path.join(__dirname, '../../email/templates'),
            path.join(__dirname, '../../email/default-templates'),
        ),
        globalTemplateVars: {
            fromAddress: process.env.EMAIL_FROM ?? '"The Makers Bazar" <noreply@themakersbazar.com>',
            passwordResetUrl: `${webOrigin}/reset-password`,
            changeEmailAddressUrl: `${webOrigin}/change-email-address`,
            applicationStatusUrl: `${webOrigin}/application-status`,
            loginUrl: `${webOrigin}/login`,
            ordersUrl: `${webOrigin}/dashboard/customer/orders`,
            storefrontUrl: webOrigin,
        },
    };
    if (process.env.SMTP_HOST) {
        return EmailPlugin.init({
            ...commonOptions,
            transport: {
                type: 'smtp',
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT ?? 587),
                secure: process.env.SMTP_SECURE === 'true',
                auth: process.env.SMTP_USER
                    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
                    : undefined,
            },
        });
    }
    return EmailPlugin.init({
        ...commonOptions,
        devMode: true,
        outputPath: path.join(__dirname, '../../test-emails'),
        route: 'mailbox',
    });
}

function getDatabaseConfig(): VendureConfig['dbConnectionOptions'] {
    if (process.env.DB === 'postgres') {
        return {
            type: 'postgres',
            synchronize: isDevelopment,
            migrations: [path.join(__dirname, '../migrations/*.+(js|ts)')],
            logging: false,
            host: process.env.DB_HOST ?? 'localhost',
            port: Number(process.env.DB_PORT ?? 5432),
            username: process.env.DB_USERNAME ?? 'vendure',
            password: process.env.DB_PASSWORD ?? 'password',
            database: process.env.DB_NAME ?? 'marketplace',
            schema: process.env.DB_SCHEMA ?? 'public',
        };
    }

    return {
        type: 'better-sqlite3',
        synchronize: true,
        migrations: [path.join(__dirname, '../migrations/*.+(js|ts)')],
        logging: false,
        database: path.resolve(process.cwd(), process.env.DB_PATH ?? './data/marketplace.sqlite'),
        enableWAL: true,
        timeout: 15_000,
    };
}
