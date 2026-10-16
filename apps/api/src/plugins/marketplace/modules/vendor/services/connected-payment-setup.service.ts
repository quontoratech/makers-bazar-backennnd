import { Injectable } from '@nestjs/common';
import {
    Channel,
    ChannelService,
    Country,
    CountryService,
    LanguageCode,
    PaymentMethod,
    PaymentMethodService,
    RequestContextService,
    TransactionalConnection,
    Zone,
    ZoneService,
} from '@vendure/core';

import { CONNECTED_PAYMENT_METHOD_CODE } from '../../../constants';
import { multivendorPaymentMethodHandler } from '../config/multivendor-payment-handler';

@Injectable()
export class ConnectedPaymentSetupService {
    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private requestContextService: RequestContextService,
        private paymentMethodService: PaymentMethodService,
        private countryService: CountryService,
        private zoneService: ZoneService,
    ) {}

    async ensureMarketplaceInfrastructure() {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const existing = await this.connection.rawConnection.getRepository(PaymentMethod).findOne({
            where: { code: CONNECTED_PAYMENT_METHOD_CODE },
        });
        const channels = await this.connection.getRepository(ctx, Channel).find();
        const paymentMethod = existing ?? await this.paymentMethodService.create(ctx, {
                code: CONNECTED_PAYMENT_METHOD_CODE,
                enabled: true,
                handler: {
                    code: multivendorPaymentMethodHandler.code,
                    arguments: [],
                },
                translations: [
                    {
                        languageCode: ctx.languageCode,
                        name: 'Marketplace offline order placement',
                    },
                ],
            });
        await this.channelService.assignToChannels(
            ctx,
            PaymentMethod,
            paymentMethod.id,
            channels.map(channel => channel.id),
        );

        const countryRepository = this.connection.rawConnection.getRepository(Country);
        let pakistan = await countryRepository.findOne({ where: { code: 'PK' } });
        if (!pakistan) {
            pakistan = await this.countryService.create(ctx, {
                code: 'PK',
                enabled: true,
                translations: [{ languageCode: LanguageCode.en, name: 'Pakistan' }],
            });
        } else if (!pakistan.enabled) {
            pakistan = await this.countryService.update(ctx, {
                id: pakistan.id,
                enabled: true,
            });
        }
        const zones = await this.connection.getRepository(ctx, Zone).find({ relations: ['members'] });
        for (const zone of zones) {
            if (!zone.members.some(member => String(member.id) === String(pakistan.id))) {
                await this.zoneService.addMembersToZone(ctx, {
                    zoneId: zone.id,
                    memberIds: [pakistan.id],
                });
            }
        }
    }
}
