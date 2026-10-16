import { ForbiddenError, ID, RequestContext } from '@vendure/core';

export function requireActiveUserId(ctx: RequestContext): ID {
    if (ctx.activeUserId == null) {
        throw new ForbiddenError();
    }
    return ctx.activeUserId;
}

export function assertResourceOwner(ctx: RequestContext, ownerUserId: string): void {
    const activeUserId = requireActiveUserId(ctx);
    if (String(activeUserId) !== ownerUserId) {
        throw new ForbiddenError();
    }
}
