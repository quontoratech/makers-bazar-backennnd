import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddWorkshopDayPassPrice1788141600000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('marketplace_availability_session')
            && !await queryRunner.hasColumn('marketplace_availability_session', 'oneDayPrice')) {
            await queryRunner.addColumn('marketplace_availability_session', new TableColumn({
                name: 'oneDayPrice',
                type: 'integer',
                isNullable: true,
            }));
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('marketplace_availability_session')
            && await queryRunner.hasColumn('marketplace_availability_session', 'oneDayPrice')) {
            await queryRunner.dropColumn('marketplace_availability_session', 'oneDayPrice');
        }
    }
}
