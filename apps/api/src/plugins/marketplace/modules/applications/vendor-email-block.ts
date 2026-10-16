import { Repository } from 'typeorm';

import { RoleApplication } from './entities/role-application.entity';

export function normalizeVendorApplicationEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function blockedVendorApplication(
    repository: Repository<RoleApplication>,
    email: string,
): Promise<RoleApplication | null> {
    return repository
        .createQueryBuilder('application')
        .where('application.role = :role', { role: 'VENDOR' })
        .andWhere('application.status = :status', { status: 'BLOCKED' })
        .andWhere('LOWER(TRIM(application.emailAddress)) = :email', {
            email: normalizeVendorApplicationEmail(email),
        })
        .getOne();
}

export async function assertVendorApplicationEmailAllowed(
    repository: Repository<RoleApplication>,
    email: string,
): Promise<void> {
    if (await blockedVendorApplication(repository, email)) {
        throw new Error('Vendor applications from this email address are blocked. Contact support for help.');
    }
}
