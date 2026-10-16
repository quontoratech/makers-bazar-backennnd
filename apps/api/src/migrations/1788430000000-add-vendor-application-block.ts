import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddVendorApplicationBlock1788430000000 implements MigrationInterface {
    async up(runner: QueryRunner) {
        const timestamp = runner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await runner.addColumns('role_application', [
            new TableColumn({ name: 'blockedAt', type: timestamp, isNullable: true }),
            new TableColumn({ name: 'blockedReason', type: 'text', isNullable: true }),
            new TableColumn({ name: 'blockedByUserId', type: 'varchar', isNullable: true }),
        ]);
    }

    async down(runner: QueryRunner) {
        await runner.dropColumn('role_application', 'blockedByUserId');
        await runner.dropColumn('role_application', 'blockedReason');
        await runner.dropColumn('role_application', 'blockedAt');
    }
}
