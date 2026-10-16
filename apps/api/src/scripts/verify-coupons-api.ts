import assert from 'node:assert/strict';

const endpoint = process.env.COUPON_QA_API_URL ?? 'http://localhost:3002/admin-api';
const username = process.env.SUPERADMIN_USERNAME;
const password = process.env.SUPERADMIN_PASSWORD;
assert(username && password, 'Super-admin QA credentials are required');

async function graphQl<T>(query: string, variables?: Record<string, unknown>, token?: string) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> };
    if (!response.ok || payload.errors?.length || !payload.data) {
        throw new Error(payload.errors?.[0]?.message ?? `Coupon API QA failed with HTTP ${response.status}`);
    }
    return { data: payload.data, response };
}

async function verify() {
    const login = await graphQl<{ login: { id?: string; message?: string } }>(`
        mutation Login($username: String!, $password: String!) {
            login(username: $username, password: $password, rememberMe: false) {
                ... on CurrentUser { id }
                ... on ErrorResult { message }
            }
        }
    `, { username, password });
    assert(login.data.login.id, login.data.login.message ?? 'Super-admin login failed');
    const token = login.response.headers.get('vendure-auth-token');
    assert(token, 'Vendure did not return an authentication token');

    const targets = await graphQl<{
        marketplaceAffiliates: { items: Array<{ id: string; slug: string; referralCode: string; displayName: string; status: string }> };
        marketplaceVendors: { items: Array<{ id: string; slug: string; shopName: string }> };
        marketplaceCategories: Array<{ id: string; code: string; name: string }>;
        marketplacePromotionCampaigns: { items: Array<{ id: string; code: string; title: string }> };
    }>(`
        query CouponTargets {
            marketplaceAffiliates(options: { take: 10 }) { items { id slug referralCode displayName status } }
            marketplaceVendors(options: { take: 1 }, status: "APPROVED") { items { id slug shopName } }
            marketplaceCategories(includeInactive: false) { id code name }
            marketplacePromotionCampaigns(options: { take: 1 }) { items { id code title } }
        }
    `, undefined, token);

    const stamp = Date.now().toString(36).toUpperCase();
    const cases: Array<{
        scope: 'GLOBAL' | 'VENDOR' | 'CATEGORY' | 'CAMPAIGN';
        target?: { id: string; code: string; name: string };
    }> = [{ scope: 'GLOBAL' }];
    const vendor = targets.data.marketplaceVendors.items[0];
    if (vendor) cases.push({ scope: 'VENDOR', target: { id: vendor.id, code: vendor.slug, name: vendor.shopName } });
    const category = targets.data.marketplaceCategories[0];
    if (category) cases.push({ scope: 'CATEGORY', target: category });
    const campaign = targets.data.marketplacePromotionCampaigns.items[0];
    if (campaign) cases.push({ scope: 'CAMPAIGN', target: { id: campaign.id, code: campaign.code, name: campaign.title } });

    const createdIds: string[] = [];
    try {
        for (const item of cases) {
            const code = `QA_${item.scope.slice(0, 3)}_${stamp}`;
            const created: {
                data: { createMarketplaceCoupon: { id: string; code: string; purpose: string; scope: string } };
                response: Response;
            } = await graphQl<{ createMarketplaceCoupon: { id: string; code: string; purpose: string; scope: string } }>(`
                mutation CreateCoupon($input: CreateMarketplaceCouponInput!) {
                    createMarketplaceCoupon(input: $input) { id code purpose scope }
                }
            `, {
                input: {
                    code,
                    name: `${item.scope} coupon QA`,
                    scope: item.scope,
                    targetId: item.target?.id,
                    targetCode: item.target?.code,
                    targetName: item.target?.name,
                    discountType: 'FIXED',
                    discountValue: 100,
                    minimumSpend: 0,
                    currencyCode: 'PKR',
                    fundingSource: item.scope === 'VENDOR' ? 'VENDOR' : 'MARKETPLACE',
                    perCustomerUsageLimit: 1,
                    status: 'ACTIVE',
                },
            }, token);
            assert.equal(created.data.createMarketplaceCoupon.code, code);
            assert.equal(created.data.createMarketplaceCoupon.purpose, 'PROMOTION');
            assert.equal(created.data.createMarketplaceCoupon.scope, item.scope);
            createdIds.push(created.data.createMarketplaceCoupon.id);
        }

        const influencer = targets.data.marketplaceAffiliates.items.find(item => item.status === 'APPROVED');
        if (influencer) {
            const code = `QA_INF_${stamp}`;
            const created = await graphQl<{
                createMarketplaceCoupon: {
                    id: string;
                    purpose: string;
                    rewardRecipientType?: string | null;
                    rewardRecipientId?: string | null;
                    scope: string;
                    targetId?: string | null;
                };
            }>(`
                mutation CreateCoupon($input: CreateMarketplaceCouponInput!) {
                    createMarketplaceCoupon(input: $input) {
                        id purpose rewardRecipientType rewardRecipientId scope targetId
                    }
                }
            `, {
                input: {
                    code,
                    name: 'Influencer reward coupon QA',
                    purpose: 'REWARD',
                    rewardRecipientType: 'INFLUENCER',
                    rewardRecipientId: influencer.id,
                    rewardRecipientCode: influencer.slug || influencer.referralCode,
                    rewardRecipientName: influencer.displayName,
                    scope: 'VENDOR',
                    discountType: 'PERCENTAGE',
                    discountValue: 10,
                    minimumSpend: 0,
                    currencyCode: 'PKR',
                    fundingSource: 'MARKETPLACE',
                    perCustomerUsageLimit: 1,
                    status: 'ACTIVE',
                },
            }, token);
            assert.equal(created.data.createMarketplaceCoupon.purpose, 'REWARD');
            assert.equal(created.data.createMarketplaceCoupon.rewardRecipientType, 'INFLUENCER');
            assert.equal(created.data.createMarketplaceCoupon.rewardRecipientId, influencer.id);
            assert.equal(created.data.createMarketplaceCoupon.scope, 'GLOBAL');
            assert.equal(created.data.createMarketplaceCoupon.targetId, null);
            createdIds.push(created.data.createMarketplaceCoupon.id);
        }

        if (vendor) {
            const code = `QA_VRE_${stamp}`;
            const created = await graphQl<{
                createMarketplaceCoupon: {
                    id: string;
                    purpose: string;
                    rewardRecipientType?: string | null;
                    rewardRecipientId?: string | null;
                    scope: string;
                    targetId?: string | null;
                };
            }>(`
                mutation CreateCoupon($input: CreateMarketplaceCouponInput!) {
                    createMarketplaceCoupon(input: $input) {
                        id purpose rewardRecipientType rewardRecipientId scope targetId
                    }
                }
            `, {
                input: {
                    code,
                    name: 'Vendor reward coupon QA',
                    purpose: 'REWARD',
                    rewardRecipientType: 'VENDOR',
                    rewardRecipientId: vendor.id,
                    rewardRecipientCode: vendor.slug,
                    rewardRecipientName: vendor.shopName,
                    scope: 'GLOBAL',
                    discountType: 'PERCENTAGE',
                    discountValue: 10,
                    minimumSpend: 0,
                    currencyCode: 'PKR',
                    fundingSource: 'VENDOR',
                    perCustomerUsageLimit: 1,
                    status: 'ACTIVE',
                },
            }, token);
            assert.equal(created.data.createMarketplaceCoupon.purpose, 'REWARD');
            assert.equal(created.data.createMarketplaceCoupon.rewardRecipientType, 'VENDOR');
            assert.equal(created.data.createMarketplaceCoupon.rewardRecipientId, vendor.id);
            assert.equal(created.data.createMarketplaceCoupon.scope, 'VENDOR');
            assert.equal(created.data.createMarketplaceCoupon.targetId, vendor.id);
            createdIds.push(created.data.createMarketplaceCoupon.id);
        }

        const dashboard = await graphQl<{
            marketplaceCoupons: { items: Array<{ id: string }>; totalItems: number };
            marketplaceCouponDashboard: { activeCoupons: number };
        }>(`
            query CouponDashboard {
                marketplaceCoupons(options: { take: 200 }) { items { id } totalItems }
                marketplaceCouponDashboard { activeCoupons }
            }
        `, undefined, token);
        for (const id of createdIds) {
            assert(dashboard.data.marketplaceCoupons.items.some(item => item.id === id));
        }
    } finally {
        for (const id of createdIds) {
            await graphQl<{ deleteMarketplaceCoupon: { success: boolean } }>(`
                mutation DeleteCoupon($id: ID!) { deleteMarketplaceCoupon(id: $id) { success } }
            `, { id }, token);
        }
    }

    console.log(`Coupon Admin API checks passed for ${cases.map(item => item.scope).join(', ')} scopes.`);
}

void verify().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
