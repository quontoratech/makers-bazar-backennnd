export {};

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            API_PORT?: string;
            APP_ENV?: 'dev' | 'production' | 'test';
            COOKIE_SECRET?: string;
            DB?: 'sqlite' | 'postgres';
            DB_HOST?: string;
            DB_NAME?: string;
            DB_PASSWORD?: string;
            DB_PATH?: string;
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
            WEB_ORIGIN?: string;
        }
    }
}
