import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddVendorOnboarding1788350000000 implements MigrationInterface {
    async up(runner: QueryRunner) {
        const timestamp = runner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        const base = [
            { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' as const },
            { name: 'createdAt', type: timestamp, default: 'CURRENT_TIMESTAMP' },
            { name: 'updatedAt', type: timestamp, default: 'CURRENT_TIMESTAMP' },
        ];
        await runner.createTable(new Table({ name: 'vendor_onboarding', columns: [...base,
            { name: 'ownerUserId', type: 'varchar', isUnique: true }, { name: 'emailAddress', type: 'varchar' },
            { name: 'storeName', type: 'varchar', default: "''" }, { name: 'city', type: 'varchar', default: "''" },
            { name: 'businessType', type: 'varchar', default: "''" }, { name: 'version', type: 'integer', default: 1 },
            { name: 'currentStep', type: 'integer', default: 0 }, { name: 'sections', type: 'text' },
            { name: 'applicationId', type: 'varchar', isNullable: true }, { name: 'firstProductId', type: 'varchar', isNullable: true },
        ] }), true);
        await runner.createTable(new Table({ name: 'vendor_onboarding_file', columns: [...base,
            ...['onboardingId', 'fieldKey', 'name', 'mimeType', 'checksum', 'storageKey'].map(name => ({ name, type: 'varchar' })),
            { name: 'size', type: 'integer' }, { name: 'scanStatus', type: 'varchar', default: "'UNAVAILABLE'" },
        ] }), true);
        await runner.createIndex('vendor_onboarding', new TableIndex({ name: 'IDX_onboarding_email', columnNames: ['emailAddress'] }));
        await runner.createIndex('vendor_onboarding_file', new TableIndex({ name: 'IDX_onboarding_file_field', columnNames: ['onboardingId', 'fieldKey'] }));
    }
    async down(runner: QueryRunner) {
        await runner.dropTable('vendor_onboarding_file', true);
        await runner.dropTable('vendor_onboarding', true);
    }
}
