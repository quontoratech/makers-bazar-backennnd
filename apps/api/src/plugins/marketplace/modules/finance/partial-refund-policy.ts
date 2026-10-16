/** Allocates integer minor units by cumulative quantity so successive returns sum exactly to the sale. */
export function partialReturnPortion(total: number, orderedQuantity: number, previouslyReturned: number, newlyReturned: number): number {
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(orderedQuantity) || orderedQuantity < 1
        || !Number.isSafeInteger(previouslyReturned) || previouslyReturned < 0
        || !Number.isSafeInteger(newlyReturned) || newlyReturned < 0
        || previouslyReturned + newlyReturned > orderedQuantity) {
        throw new Error('Invalid partial return allocation');
    }
    return Number(BigInt(total) * BigInt(previouslyReturned + newlyReturned) / BigInt(orderedQuantity)
        - BigInt(total) * BigInt(previouslyReturned) / BigInt(orderedQuantity));
}

/** Allocates a seller-order discount across successive refund amounts without over-refunding it. */
export function partialReturnFunding(total: number, productTotal: number, previouslyRefunded: number, newlyRefunded: number): number {
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(productTotal) || productTotal < 1
        || !Number.isSafeInteger(previouslyRefunded) || previouslyRefunded < 0
        || !Number.isSafeInteger(newlyRefunded) || newlyRefunded < 0
        || previouslyRefunded + newlyRefunded > productTotal) {
        throw new Error('Invalid partial return funding');
    }
    return Number(BigInt(total) * BigInt(previouslyRefunded + newlyRefunded) / BigInt(productTotal)
        - BigInt(total) * BigInt(previouslyRefunded) / BigInt(productTotal));
}
