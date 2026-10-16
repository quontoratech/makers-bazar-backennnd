export const supportedCoinsPerPkr = [1, 2, 4, 5, 10, 20, 25, 50, 100] as const;

export function validateCoinsPerPkr(value: unknown) {
    const rate = Number(value);
    if (!Number.isInteger(rate) || rate <= 0 || rate > 100 || 100 % rate !== 0) {
        throw new Error('Coins per PKR must divide 100 exactly so every coin has an exact paisa value');
    }
    return rate;
}

export function rewardCoinValueMinor(coinsPerPkr: number) {
    return 100 / validateCoinsPerPkr(coinsPerPkr);
}

export function maximumRedeemableCoins(walletBalance: number, productSubtotal: number, coinsPerPkr: number) {
    return Math.max(0, Math.min(
        Math.floor(walletBalance),
        Math.floor(productSubtotal / rewardCoinValueMinor(coinsPerPkr)),
    ));
}

export function customerFundedProductAmount(productSubtotal: number, rewardFunding: number) {
    return Math.max(0, productSubtotal - rewardFunding);
}

export function allocateCoinsByWeight(coins: number, weights: number[]) {
    const totalWeight = weights.reduce((total, weight) => total + Math.max(0, weight), 0);
    if (!Number.isInteger(coins) || coins < 0 || totalWeight <= 0 || !weights.length) {
        throw new Error('Reward coins require a positive seller allocation');
    }
    let allocated = 0;
    return weights.map((weight, index) => {
        const value = index === weights.length - 1
            ? coins - allocated
            : Math.floor(coins * Math.max(0, weight) / totalWeight);
        allocated += value;
        return value;
    });
}
