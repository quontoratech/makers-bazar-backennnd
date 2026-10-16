import { Allocation, Order, OrderState, RequestContext, StockAllocationStrategy, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';

export class CheckoutStockAllocationStrategy implements StockAllocationStrategy {
    private connection: TransactionalConnection;

    init(injector: { get<T>(type: new (...args: any[]) => T): T }) {
        this.connection = injector.get(TransactionalConnection);
    }

    async shouldAllocateStock(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): Promise<boolean> {
        if (fromState !== 'AddingItems' || toState !== 'ArrangingPayment') return false;
        const lineIds = order.lines.map(line => line.id);
        if (!lineIds.length) return false;
        const existingAllocations = await this.connection.getRepository(ctx, Allocation).find({
            where: { orderLine: { id: In(lineIds) } },
            relations: ['orderLine'],
        });
        return existingAllocations.length === 0;
    }
}
