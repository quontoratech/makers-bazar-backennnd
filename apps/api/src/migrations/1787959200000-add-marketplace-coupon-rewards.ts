import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddMarketplaceCouponRewards1787959200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('marketplace_coupon');
        if (!table) return;
        const columns = new Set(table.columns.map(column => column.name));
        const newColumns = [
            !columns.has('purpose') ? new TableColumn({
                name: 'purpose',
                type: 'varchar',
                default: "'PROMOTION'",
            }) : undefined,
            !columns.has('rewardRecipientType') ? new TableColumn({
                name: 'rewardRecipientType',
                type: 'varchar',
                isNullable: true,
            }) : undefined,
            !columns.has('rewardRecipientId') ? new TableColumn({
                name: 'rewardRecipientId',
                type: 'varchar',
                isNullable: true,
            }) : undefined,
            !columns.has('rewardRecipientCode') ? new TableColumn({
                name: 'rewardRecipientCode',
                type: 'varchar',
                isNullable: true,
            }) : undefined,
            !columns.has('rewardRecipientName') ? new TableColumn({
                name: 'rewardRecipientName',
                type: 'varchar',
                isNullable: true,
            }) : undefined,
        ].filter((column): column is TableColumn => Boolean(column));
        if (newColumns.length) {
            await queryRunner.addColumns('marketplace_coupon', newColumns);
        }
        const updatedTable = await queryRunner.getTable('marketplace_coupon');
        const indices = new Set(updatedTable?.indices.map(index => index.name) ?? []);
        const newIndices = [
            !indices.has('IDX_marketplace_coupon_purpose')
                ? new TableIndex({ name: 'IDX_marketplace_coupon_purpose', columnNames: ['purpose'] })
                : undefined,
            !indices.has('IDX_marketplace_coupon_reward_recipient_type')
                ? new TableIndex({
                    name: 'IDX_marketplace_coupon_reward_recipient_type',
                    columnNames: ['rewardRecipientType'],
                })
                : undefined,
            !indices.has('IDX_marketplace_coupon_reward_recipient_id')
                ? new TableIndex({
                    name: 'IDX_marketplace_coupon_reward_recipient_id',
                    columnNames: ['rewardRecipientId'],
                })
                : undefined,
        ].filter((index): index is TableIndex => Boolean(index));
        if (newIndices.length) {
            await queryRunner.createIndices('marketplace_coupon', newIndices);
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('marketplace_coupon');
        if (!table) return;
        const indices = new Set(table.indices.map(index => index.name));
        for (const indexName of [
            'IDX_marketplace_coupon_reward_recipient_id',
            'IDX_marketplace_coupon_reward_recipient_type',
            'IDX_marketplace_coupon_purpose',
        ]) {
            if (indices.has(indexName)) {
                await queryRunner.dropIndex('marketplace_coupon', indexName);
            }
        }
        const refreshed = await queryRunner.getTable('marketplace_coupon');
        const columns = new Set(refreshed?.columns.map(column => column.name) ?? []);
        for (const columnName of [
            'rewardRecipientName',
            'rewardRecipientCode',
            'rewardRecipientId',
            'rewardRecipientType',
            'purpose',
        ]) {
            if (columns.has(columnName)) {
                await queryRunner.dropColumn('marketplace_coupon', columnName);
            }
        }
    }
}
