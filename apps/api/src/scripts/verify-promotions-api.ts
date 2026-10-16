import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import 'reflect-metadata';
import { DataSource } from 'typeorm';

const endpoint = process.env.PROMOTION_QA_API_URL ?? 'http://localhost:3002/admin-api';
const database = process.env.PROMOTION_QA_DB;
assert(
    database && database.startsWith('/private/tmp/marketplace-promotion-qa-'),
    'Use a temporary promotion QA database, never the live database',
);
const dataSource = new DataSource({ type: 'better-sqlite3', database });
let adminToken = '';
type Actor = { token: string; channel?: string };
type Request = {
    id: string;
    code: string;
    status: string;
    paymentStatus: string;
    amount: number;
    pricePerDay: number;
    startsAt: string;
    endsAt: string;
    durationDays: number;
    approvedAt?: string;
};
const fields = 'id code status paymentStatus amount pricePerDay startsAt endsAt durationDays approvedAt';

async function gql<T>(
    query: string,
    variables?: Record<string, unknown>,
    actor: Actor = { token: adminToken },
) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(actor.token ? { authorization: `Bearer ${actor.token}` } : {}),
            ...(actor.channel ? { 'vendure-token': actor.channel } : {}),
        },
        body: JSON.stringify({ query, variables }),
    });
    const result = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (!response.ok || result.errors?.length || !result.data)
        throw new Error(result.errors?.[0]?.message ?? `HTTP ${response.status}`);
    return { data: result.data, response };
}
async function login(username: string, password: string) {
    const result = await gql<{ login: { id?: string; message?: string } }>(
        'mutation($username: String!, $password: String!) { login(username: $username, password: $password) { ... on CurrentUser { id } ... on ErrorResult { message } } }',
        { username, password },
        { token: '' },
    );
    assert(result.data.login.id, result.data.login.message);
    const token = result.response.headers.get('vendure-auth-token');
    assert(token);
    return token;
}
async function mutation<T>(
    name: string,
    type: string,
    input: Record<string, unknown>,
    selection: string,
    actor?: Actor,
) {
    const value = (
        await gql<Record<string, T>>(
            `mutation($input: ${type}!) { ${name}(input: $input) { ${selection} } }`,
            { input },
            actor,
        )
    ).data[name];
    assert(value !== undefined, `${name} returned no result`);
    return value;
}
function review(id: string, status: string, adminNote?: string) {
    return mutation<Request>(
        'reviewMarketplacePromotionRequest',
        'ReviewMarketplacePromotionRequestInput',
        { id, status, adminNote },
        fields,
    );
}
function pay(id: string, reference: string, actor: Actor) {
    return mutation<Request>(
        'submitMarketplacePromotionPayment',
        'SubmitMarketplacePromotionPaymentInput',
        { id, paymentReference: reference },
        fields,
        actor,
    );
}

async function main() {
    await dataSource.initialize();
    const stamp = randomUUID().slice(0, 8);
    let qaAdminId: string | undefined;
    try {
        adminToken = await login(
            process.env.SUPERADMIN_USERNAME ?? 'superadmin',
            process.env.SUPERADMIN_PASSWORD ?? 'superadmin',
        );
        for (const table of [
            'marketplace_promotion_payment',
            'marketplace_promotion_request',
            'marketplace_promotion_rate',
            'promotion_campaign',
            'marketplace_promotion_settings',
        ]) {
            await dataSource.createQueryBuilder().delete().from(table).execute();
        }
        const vendors = (await dataSource.query(
            'SELECT v.id, v.channelId, c.token FROM vendor_profile v JOIN channel c ON c.id = v.channelId WHERE v.status = ? AND v.paused = 0',
            ['APPROVED'],
        )) as Array<{ id: number; channelId: string; token: string }>;
        let vendor: (typeof vendors)[number] | undefined;
        let products: Array<{ id: string; name: string; categoryId: string; categoryCode: string }> = [];
        for (const candidate of vendors) {
            const result = await gql<{ myMarketplaceProducts: { items: typeof products } }>(
                'query { myMarketplaceProducts { items { id name categoryId categoryCode enabled } } }',
                undefined,
                { token: adminToken, channel: candidate.token },
            );
            const items = result.data.myMarketplaceProducts.items.filter(
                item => (item as { enabled?: boolean }).enabled && item.categoryId,
            );
            if (items.length >= 3) {
                vendor = candidate;
                products = items;
                break;
            }
        }
        assert(vendor && products.length >= 3, 'QA needs an approved vendor with three published listings');
        const first = products[0];
        const second = products[1];
        const third = products[2];
        assert(first && second && third);
        const roles = (
            await gql<{
                roles: {
                    items: Array<{ id: string; permissions: string[]; channels: Array<{ id: string }> }>;
                };
            }>('query { roles(options: { take: 100 }) { items { id permissions channels { id } } } }')
        ).data.roles.items;
        const role = roles.find(
            item =>
                item.permissions.includes('ReadPromotion') &&
                !item.permissions.includes('SuperAdmin') &&
                item.channels.some(channel => channel.id === vendor!.channelId),
        );
        assert(role, 'Vendor role not found');
        const identifier = `promotion-qa-${stamp}@example.test`;
        const password = randomUUID();
        const administrator = await mutation<{ id: string; user: { id: string } }>(
            'createAdministrator',
            'CreateAdministratorInput',
            {
                firstName: 'Promotion',
                lastName: 'QA',
                emailAddress: identifier,
                password,
                roleIds: [role.id],
            },
            'id user { id }',
        );
        qaAdminId = administrator.id;
        const applications = (await dataSource.query(
            'SELECT * FROM role_application WHERE role = ? AND status = ? LIMIT 1',
            ['VENDOR', 'ACCOUNT_CREATED'],
        )) as Array<Record<string, unknown>>;
        assert(applications[0], 'QA needs an approved vendor application');
        const { id: _applicationId, ...application } = applications[0];
        await dataSource
            .createQueryBuilder()
            .insert()
            .into('role_application')
            .values({
                ...application,
                reference: `PROMOTION-QA-${stamp}`,
                emailAddress: identifier,
                provisionedUserId: administrator.user.id,
                mustChangePassword: false,
                displayName: 'Promotion QA',
                vendorProfileId: String(vendor.id),
            })
            .execute();
        const actor = { token: await login(identifier, password), channel: vendor.token };
        await assert.rejects(
            () => gql('query { marketplacePromotionRates { id } }', undefined, actor),
            /authorized|permission|forbidden/i,
        );
        await assert.rejects(
            () => gql('query { myMarketplacePromotionRequests { items { id } } }', undefined, { token: '' }),
            /authorized|permission|forbidden/i,
        );
        await mutation(
            'updateMarketplacePromotionSettings',
            'UpdateMarketplacePromotionSettingsInput',
            {
                homeSlots: 2,
                categorySlots: 2,
                paymentWindowHours: 48,
                paymentInstructions: 'QA only: bank payment instructions',
            },
            'homeSlots',
        );

        const rateIds: string[] = [];
        for (const [placement, pricePerDay] of [
            ['HOME', 10000],
            ['CATEGORY', 6000],
            ['BOTH', 15000],
        ] as const) {
            const rate = await mutation<{ id: string }>(
                'createMarketplacePromotionRate',
                'CreateMarketplacePromotionRateInput',
                { scope: 'GLOBAL', placement, pricePerDay },
                'id',
            );
            rateIds.push(rate.id);
        }
        const start = new Date(Date.now() + 60000).toISOString();
        const input = { productId: first.id, placement: 'BOTH', startsAt: start, durationDays: 7 };
        async function quote(value = input) {
            return (
                await gql<{
                    myMarketplacePromotionQuote: { amount: number; rateScope: string; available: boolean };
                }>(
                    'query($input: CreateMarketplacePromotionRequestInput!) { myMarketplacePromotionQuote(input: $input) { amount rateScope available } }',
                    { input: value },
                    actor,
                )
            ).data.myMarketplacePromotionQuote;
        }
        assert.equal((await quote()).amount, 105000);
        for (const [scope, target, pricePerDay] of [
            ['CATEGORY', { categoryId: first.categoryId }, 20000],
            ['VENDOR', { vendorProfileId: String(vendor.id) }, 25000],
            ['VENDOR_CATEGORY', { vendorProfileId: String(vendor.id), categoryId: first.categoryId }, 30000],
        ] as const) {
            const rate = await mutation<{ id: string }>(
                'createMarketplacePromotionRate',
                'CreateMarketplacePromotionRateInput',
                { scope, ...target, placement: 'BOTH', pricePerDay },
                'id',
            );
            rateIds.push(rate.id);
            assert.equal((await quote()).rateScope, scope);
            assert.equal((await quote()).amount, pricePerDay * 7);
        }
        const campaign = await mutation<{ id: string }>(
            'createMarketplacePromotion',
            'CreateMarketplacePromotionInput',
            {
                title: `QA ${stamp}`,
                ownerType: 'PLATFORM',
                campaignType: 'PLACEMENT',
                placement: 'BOTH',
                startsAt: new Date().toISOString(),
                endsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
                maxPlacements: 2,
            },
            'id',
        );
        await assert.rejects(
            () =>
                mutation(
                    'createMarketplacePromotion',
                    'CreateMarketplacePromotionInput',
                    {
                        title: `Invalid ${stamp}`,
                        ownerType: 'PLATFORM',
                        campaignType: 'PLACEMENT',
                        placement: 'SIDEBAR',
                        startsAt: new Date().toISOString(),
                        endsAt: new Date(Date.now() + 86400000).toISOString(),
                    },
                    'id',
                ),
            /valid promotion placement/i,
        );
        await mutation(
            'reviewMarketplacePromotion',
            'ReviewMarketplacePromotionInput',
            { id: campaign.id, status: 'ACTIVE' },
            'id',
        );
        const extendedEnd = new Date(Date.now() + 45 * 86400000).toISOString();
        const editedCampaign = await mutation<{
            id: string;
            title: string;
            description?: string;
            endsAt: string;
            maxPlacements: number;
        }>(
            'updateMarketplacePromotion',
            'UpdateMarketplacePromotionInput',
            {
                id: campaign.id,
                title: `QA edited ${stamp}`,
                description: 'Campaign edit integration check',
                endsAt: extendedEnd,
                maxPlacements: 2,
            },
            'id title description endsAt maxPlacements',
        );
        assert.equal(editedCampaign.title, `QA edited ${stamp}`);
        assert.equal(editedCampaign.description, 'Campaign edit integration check');
        assert.equal(new Date(editedCampaign.endsAt).getTime(), new Date(extendedEnd).getTime());
        const clearedCampaign = await mutation<{ description: string | null }>(
            'updateMarketplacePromotion',
            'UpdateMarketplacePromotionInput',
            { id: campaign.id, description: '' },
            'description',
        );
        assert.equal(clearedCampaign.description, null, 'An empty edit must clear the campaign description');
        await mutation(
            'updateMarketplacePromotion',
            'UpdateMarketplacePromotionInput',
            { id: campaign.id, description: 'Campaign edit integration check' },
            'id',
        );
        const publicCampaignResponse = await fetch(endpoint.replace('/admin-api', '/shop-api'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                query: 'query { activeMarketplaceCampaigns(placement: "HOME") { id placement } }',
            }),
        });
        const publicCampaignPayload = (await publicCampaignResponse.json()) as {
            data?: { activeMarketplaceCampaigns: Array<{ id: string; placement: string }> };
            errors?: Array<{ message: string }>;
        };
        assert(!publicCampaignPayload.errors?.length, publicCampaignPayload.errors?.[0]?.message);
        assert(
            publicCampaignPayload.data?.activeMarketplaceCampaigns.some(item => item.id === campaign.id),
            'A BOTH campaign must be discoverable for HOME placement',
        );
        const terminalCampaign = await mutation<{ id: string }>(
            'createMarketplacePromotion',
            'CreateMarketplacePromotionInput',
            {
                title: `Terminal ${stamp}`,
                ownerType: 'PLATFORM',
                campaignType: 'PLACEMENT',
                placement: 'HOME',
                startsAt: new Date().toISOString(),
                endsAt: new Date(Date.now() + 86400000).toISOString(),
            },
            'id',
        );
        await mutation(
            'reviewMarketplacePromotion',
            'ReviewMarketplacePromotionInput',
            { id: terminalCampaign.id, status: 'COMPLETED' },
            'id',
        );
        await assert.rejects(
            () =>
                mutation(
                    'reviewMarketplacePromotion',
                    'ReviewMarketplacePromotionInput',
                    { id: terminalCampaign.id, status: 'ACTIVE' },
                    'id',
                ),
            /cannot move/i,
        );
        const campaignRate = await mutation<{ id: string }>(
            'createMarketplacePromotionRate',
            'CreateMarketplacePromotionRateInput',
            { scope: 'CAMPAIGN', campaignId: campaign.id, placement: 'BOTH', pricePerDay: 35000 },
            'id',
        );
        rateIds.push(campaignRate.id);
        assert.equal(
            (await quote({ ...input, campaignId: campaign.id } as typeof input)).rateScope,
            'CAMPAIGN',
        );
        async function request(value: Record<string, unknown>) {
            return mutation<Request>(
                'createMarketplacePromotionRequest',
                'CreateMarketplacePromotionRequestInput',
                value,
                fields,
                actor,
            );
        }
        await mutation(
            'updateMarketplacePromotionSettings',
            'UpdateMarketplacePromotionSettingsInput',
            {
                homeSlots: 3,
                categorySlots: 3,
                paymentWindowHours: 48,
                paymentInstructions: 'QA only: bank payment instructions',
            },
            'homeSlots',
        );
        const campaignA = await request({ ...input, campaignId: campaign.id });
        const campaignB = await request({ ...input, productId: second.id, campaignId: campaign.id });
        const campaignC = await request({ ...input, productId: third.id, campaignId: campaign.id });
        await review(campaignA.id, 'APPROVE_SPACE');
        await review(campaignB.id, 'APPROVE_SPACE');
        await assert.rejects(() => review(campaignC.id, 'APPROVE_SPACE'), /Campaign promotion space is full/i);
        await assert.rejects(
            () =>
                mutation(
                    'updateMarketplacePromotion',
                    'UpdateMarketplacePromotionInput',
                    { id: campaign.id, maxPlacements: 1 },
                    'id',
                ),
            /already has 2 overlapping reserved placements/i,
        );
        await assert.rejects(
            () =>
                mutation(
                    'updateMarketplacePromotion',
                    'UpdateMarketplacePromotionInput',
                    {
                        id: campaign.id,
                        endsAt: new Date(new Date(start).getTime() + 3 * 86400000).toISOString(),
                    },
                    'id',
                ),
            /dates must continue to cover/i,
        );
        await assert.rejects(
            () =>
                mutation(
                    'updateMarketplacePromotion',
                    'UpdateMarketplacePromotionInput',
                    { id: campaign.id, placement: 'HOME' },
                    'id',
                ),
            /placement must continue to support/i,
        );
        for (const id of [campaignA.id, campaignB.id, campaignC.id])
            await gql('mutation($id: ID!) { cancelMyMarketplacePromotionRequest(id: $id) { id } }', { id }, actor);
        await mutation(
            'updateMarketplacePromotionSettings',
            'UpdateMarketplacePromotionSettingsInput',
            {
                homeSlots: 2,
                categorySlots: 2,
                paymentWindowHours: 48,
                paymentInstructions: 'QA only: bank payment instructions',
            },
            'homeSlots',
        );
        await mutation(
            'updateMarketplacePromotion',
            'UpdateMarketplacePromotionInput',
            { id: campaign.id, target: { categoryCode: first.categoryCode } },
            'id',
        );
        await assert.rejects(() => request({ ...input, expectedAmount: 1 }), /price changed/i);
        await assert.rejects(() => request({ ...input, durationDays: 91 }), /90/);
        const otherProduct = (
            (await dataSource.query(
                'SELECT id FROM product WHERE customFieldsVendorprofileid != ? AND enabled = 1 AND deletedAt IS NULL LIMIT 1',
                [String(vendor.id)],
            )) as Array<{ id: number }>
        )[0];
        if (otherProduct)
            await assert.rejects(
                () => request({ ...input, productId: String(otherProduct.id) }),
                /own catalog/i,
            );

        const a = await request(input);
        const b = await request({ ...input, productId: second.id });
        const c = await request({ ...input, productId: third.id });
        assert.equal(a.status, 'PENDING_REVIEW');
        await assert.rejects(() => request(input), /already have/i);
        await assert.rejects(() => pay(a.id, `QA-${stamp}-A`, actor), /space approval/i);
        await assert.rejects(() => review(a.id, 'APPROVED'), /Verify/i);
        const reservedA = await review(a.id, 'APPROVE_SPACE');
        assert.equal(reservedA.status, 'PENDING_PAYMENT');
        assert(
            new Date(reservedA.startsAt).getTime() >= Date.now() + 47 * 3_600_000,
            'A near-term request must move once beyond its payment window before money is requested',
        );
        assert.equal((await review(b.id, 'APPROVE_SPACE')).status, 'PENDING_PAYMENT');
        await assert.rejects(() => review(c.id, 'APPROVE_SPACE'), /space is full/i);
        assert.equal((await quote({ ...input, productId: third.id })).available, false);
        const publicCatalog = async (categoryCode?: string) => {
            const response = await fetch(endpoint.replace('/admin-api', '/shop-api'), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    query: 'query($categoryCode: String) { marketplaceCatalogProducts(categoryCode: $categoryCode) { items { id isPromoted promotionRank } } }',
                    variables: { categoryCode },
                }),
            });
            const payload = (await response.json()) as {
                data?: {
                    marketplaceCatalogProducts: {
                        items: Array<{ id: string; isPromoted: boolean; promotionRank?: number }>;
                    };
                };
                errors?: Array<{ message: string }>;
            };
            assert(!payload.errors?.length, payload.errors?.[0]?.message);
            assert(payload.data);
            return payload.data.marketplaceCatalogProducts.items;
        };
        assert(!(await publicCatalog()).some(item => item.id === first.id && item.isPromoted));
        const promotionIncome = async () =>
            (
                await gql<{
                    marketplacePromotionPayments: {
                        totalItems: number;
                        summary: { netRevenue: number; pendingAmount: number };
                        items: Array<{ reference: string; status: string }>;
                    };
                }>(
                    'query { marketplacePromotionPayments { totalItems summary { netRevenue pendingAmount } items { reference status } } }',
                )
            ).data.marketplacePromotionPayments;
        assert.equal((await promotionIncome()).summary.netRevenue, 0);
        await assert.rejects(
            () => gql('query { marketplacePromotionPayments { totalItems } }', undefined, actor),
            /not.*authorized|forbidden/i,
        );
        await assert.rejects(
            () =>
                gql(
                    'mutation($id: ID!) { createMarketplacePromotionCardCheckout(id: $id) { url } }',
                    { id: a.id },
                    actor,
                ),
            /not configured/i,
        );
        await pay(a.id, `QA-${stamp}-A`, actor);
        await assert.rejects(
            () => review(a.id, 'CANCELLED', 'Stop before reviewing payment'),
            /Verify or reject the submitted payment/i,
        );
        assert.equal((await promotionIncome()).summary.netRevenue, 0, 'Submitted receipts are not income');
        assert.equal((await promotionIncome()).summary.pendingAmount, a.amount);
        await assert.rejects(() => pay(b.id, `QA-${stamp}-A`, actor), /already been used/i);
        await assert.rejects(() => review(a.id, 'APPROVED'), /Verify/i);
        await review(a.id, 'PAYMENT_VERIFIED');
        assert.equal((await promotionIncome()).summary.netRevenue, a.amount);
        assert.equal(
            (await promotionIncome()).summary.netRevenue,
            a.amount,
            'Repeated reads must not duplicate revenue',
        );
        assert(!(await publicCatalog()).some(item => item.id === first.id && item.isPromoted));
        const activatedA = await review(a.id, 'APPROVED');
        assert.equal(activatedA.startsAt, reservedA.startsAt, 'Paid activation must not move the reserved start');
        assert.equal(activatedA.endsAt, reservedA.endsAt, 'Paid activation must not move the reserved end');
        await pay(b.id, `QA-${stamp}-B`, actor);
        await review(b.id, 'PAYMENT_VERIFIED');
        await review(b.id, 'APPROVED');
        const finance = (
            await gql<{
                marketplaceFinanceDashboard: { reportSummary: Record<string, number> };
                marketplacePlatformOverview: { metrics: Record<string, { amount: number }> };
            }>(
                'query { marketplaceFinanceDashboard { reportSummary } marketplacePlatformOverview { metrics { promotionRevenue { amount } commissionRevenue { amount } marketplaceEarnings { amount } } } }',
            )
        ).data;
        assert.equal(finance.marketplaceFinanceDashboard.reportSummary.promotionRevenue, a.amount + b.amount);
        assert.equal(
            finance.marketplacePlatformOverview.metrics.marketplaceEarnings?.amount,
            (finance.marketplacePlatformOverview.metrics.commissionRevenue?.amount ?? 0) +
                a.amount +
                b.amount,
        );
        assert.equal(
            finance.marketplaceFinanceDashboard.reportSummary.marketplaceEarnings,
            (finance.marketplaceFinanceDashboard.reportSummary.commissionRevenue ?? 0) +
                (finance.marketplaceFinanceDashboard.reportSummary.feeRevenue ?? 0) +
                a.amount +
                b.amount,
        );
        const liveStart = new Date(Date.now() - 1000).toISOString().replace('T', ' ').replace('Z', '');
        await dataSource.query('UPDATE marketplace_promotion_request SET startsAt = ? WHERE id IN (?, ?)', [
            liveStart,
            a.id,
            b.id,
        ]);
        const home = (await publicCatalog()).filter(item => item.isPromoted);
        assert.equal(home[0]?.id, second.id, 'Newest activation must rank first');
        assert.equal(home[1]?.id, first.id);
        assert(
            (await publicCatalog(first.categoryCode)).some(item => item.id === first.id && item.isPromoted),
        );
        await dataSource.query('UPDATE product SET enabled = 0 WHERE id = ?', [first.id]);
        assert(!(await publicCatalog()).some(item => item.id === first.id && item.isPromoted));
        await dataSource.query('UPDATE product SET enabled = 1 WHERE id = ?', [first.id]);
        const expired = new Date(Date.now() - 1000).toISOString().replace('T', ' ').replace('Z', '');
        await dataSource.query('UPDATE marketplace_promotion_request SET endsAt = ? WHERE id = ?', [
            expired,
            b.id,
        ]);
        assert(!(await publicCatalog()).some(item => item.id === second.id && item.isPromoted));
        assert.equal(
            (await review(c.id, 'APPROVE_SPACE')).status,
            'PENDING_PAYMENT',
            'Expired placements must release capacity',
        );
        await dataSource.query('UPDATE marketplace_promotion_request SET paymentDueAt = ? WHERE id = ?', [
            expired,
            c.id,
        ]);
        await assert.rejects(() => pay(c.id, `QA-${stamp}-C`, actor), /deadline has expired/i);
        const owned = (
            await gql<{ myMarketplacePromotionRequests: { items: Request[] } }>(
                'query { myMarketplacePromotionRequests { items { id status } } }',
                undefined,
                actor,
            )
        ).data.myMarketplacePromotionRequests.items;
        assert.equal(owned.find(item => item.id === c.id)?.status, 'EXPIRED');
        const collection = await request({
            targetType: 'VENDOR_CATEGORY',
            categoryId: first.categoryId,
            placement: 'CATEGORY',
            startsAt: start,
            durationDays: 3,
        });
        await review(collection.id, 'APPROVE_SPACE');
        await pay(collection.id, `QA-${stamp}-COLLECTION`, actor);
        await review(collection.id, 'PAYMENT_VERIFIED');
        await review(collection.id, 'APPROVED');
        await dataSource.query('UPDATE marketplace_promotion_request SET startsAt = ? WHERE id = ?', [
            liveStart,
            collection.id,
        ]);
        const categoryProducts = (await publicCatalog(first.categoryCode)).filter(item => item.isPromoted);
        const ownIds = new Set(products.map(item => item.id));
        assert(
            categoryProducts.every(item => ownIds.has(item.id)),
            'Category promotion must not boost a competitor',
        );

        // Both approvals run in separate resolver transactions against one remaining slot.
        const d = await request({
            ...input,
            productId: second.id,
            placement: 'HOME',
            startsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        });
        const e = await request({
            ...input,
            productId: third.id,
            placement: 'HOME',
            startsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        });
        const concurrent = await Promise.allSettled([
            review(d.id, 'APPROVE_SPACE'),
            review(e.id, 'APPROVE_SPACE'),
        ]);
        assert.equal(
            concurrent.filter(result => result.status === 'fulfilled').length,
            1,
            'Concurrent approvals must not oversell',
        );
        const winner = concurrent[0].status === 'fulfilled' ? d : e;
        await gql(
            'mutation($id: ID!) { cancelMyMarketplacePromotionRequest(id: $id) { id } }',
            { id: winner.id },
            actor,
        );
        const loser = winner.id === d.id ? e : d;
        await review(loser.id, 'APPROVE_SPACE');
        await pay(loser.id, `QA-${stamp}-REJECT`, actor);
        await review(loser.id, 'REJECTED', 'Payment was not received');
        assert.equal((await pay(loser.id, `QA-${stamp}-RETRY`, actor)).status, 'PAYMENT_SUBMITTED');
        const history = await promotionIncome();
        assert(
            history.items.some(
                payment => payment.reference === `QA-${stamp}-REJECT` && payment.status === 'REJECTED',
            ),
        );
        assert(
            history.items.some(
                payment => payment.reference === `QA-${stamp}-RETRY` && payment.status === 'SUBMITTED',
            ),
        );
        if (process.env.PROMOTION_QA_KEEP === '1') {
            await writeFile(
                join(dirname(database!), 'browser-fixture.json'),
                JSON.stringify({
                    identifier,
                    password,
                    vendorId: String(vendor.id),
                    channel: vendor.token,
                    firstProductId: first.id,
                    firstCategoryCode: first.categoryCode,
                    campaignId: campaign.id,
                    campaignTitle: editedCampaign.title,
                }),
                { mode: 0o600 },
            );
        }
        console.log(
            'PASS: API permissions, campaign editing/status/BOTH discovery, all pricing scopes, approval/payment gates, campaign and global capacity, concurrent reservations, ranking, expiry, category collections, and payment retry',
        );
    } finally {
        if (process.env.PROMOTION_QA_KEEP !== '1' && qaAdminId)
            await gql('mutation($id: ID!) { deleteAdministrator(id: $id) { result } }', { id: qaAdminId });
        await dataSource.destroy();
    }
}
void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
