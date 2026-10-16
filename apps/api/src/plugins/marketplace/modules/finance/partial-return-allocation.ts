/** Allocate minor units cumulatively so several partial returns sum to the original amount. */
export function returnedShare(total: number, purchasedQuantity: number, alreadyReturned: number, quantity: number): number {
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(purchasedQuantity)
        || purchasedQuantity < 1 || !Number.isSafeInteger(alreadyReturned) || alreadyReturned < 0
        || !Number.isSafeInteger(quantity) || quantity < 1
        || alreadyReturned + quantity > purchasedQuantity) {
        throw new Error('Return quantity or amount is invalid');
    }
    return Math.floor(total * (alreadyReturned + quantity) / purchasedQuantity)
        - Math.floor(total * alreadyReturned / purchasedQuantity);
}

export function proportionalReturnShare(total: number, whole: number, alreadyReturned: number, amount: number): number {
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(whole) || whole < 0
        || !Number.isSafeInteger(alreadyReturned) || alreadyReturned < 0
        || !Number.isSafeInteger(amount) || amount < 0 || alreadyReturned + amount > whole) {
        throw new Error('Return allocation exceeds the original amount');
    }
    if (!whole) return 0;
    return Math.floor(total * (alreadyReturned + amount) / whole)
        - Math.floor(total * alreadyReturned / whole);
}
