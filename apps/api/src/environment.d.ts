export {};

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            API_PORT?: string;
            API_PUBLIC_URL?: string;
            APP_ENV?: 'dev' | 'production' | 'test';
            ASSET_SEED_DIR?: string;
            ASSET_UPLOAD_DIR?: string;
            AUTH_REQUIRE_VERIFICATION?: string;
            CHAT_ATTACHMENT_DIR?: string;
            CHAT_SOCKET_SECRET?: string;
            COOKIE_SECRET?: string;
            DB?: 'sqlite' | 'postgres';
            DB_HOST?: string;
            DB_NAME?: string;
            DB_PASSWORD?: string;
            DB_PATH?: string;
            DB_SEED_KEY?: string;
            DB_SEED_PATH?: string;
            DB_PORT?: string;
            DB_SCHEMA?: string;
            DB_USERNAME?: string;
            EMAIL_FROM?: string;
            SMTP_HOST?: string;
            SMTP_PASSWORD?: string;
            SMTP_PORT?: string;
            SMTP_SECURE?: string;
            SMTP_USER?: string;
            SUPERADMIN_PASSWORD?: string;
            SUPERADMIN_USERNAME?: string;
            PRIVATE_DIGITAL_ASSET_DIR?: string;
            VENDOR_ONBOARDING_DIR?: string;
            VENDOR_ONBOARDING_DOWNLOAD_SECRET?: string;
            WEB_ORIGIN?: string;
        }
    }
}
