/**
 * @description
 * Reserved boundary for a future payment provider. Direct buying uses verified company receipts.
 */
export class ConnectedPaymentAdapter {

    /**
     * Used to create a payment on the platform itself.
     */
    async createPayment(options: { amount: number; currency: string; transfer_group: string }) {
        throw new Error('An online payment provider has not been configured');
    }

    /**
     * Used to create a transfer payment to a Seller.
     */
    async createTransfer(options: {
        amount: number;
        currency: string;
        connectedAccountId: string;
        transfer_group: string;
    }) {
        throw new Error('Vendor transfers must be recorded through an approved payout batch');
    }
}
