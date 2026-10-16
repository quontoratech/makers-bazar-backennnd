export type MarketplaceRole =
    | 'customer'
    | 'vendor'
    | 'influencer'
    | 'organizer'
    | 'admin'
    | 'super-admin';

export type ApplicationRole = 'VENDOR' | 'INFLUENCER' | 'ORGANIZER';

export type ApplicationStatus =
    | 'PENDING'
    | 'UNDER_REVIEW'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'BLOCKED'
    | 'ACCOUNT_CREATED';

export interface MarketplaceSession {
    role: MarketplaceRole;
    displayName: string;
    identifier: string;
    dashboardPath: string;
    mustChangePassword: boolean;
    apiType: 'shop' | 'admin';
    channelToken: string;
    expiresAt: number;
}

export interface RoleApplicationSummary {
    id: string;
    createdAt: string;
    updatedAt: string;
    reference: string;
    role: ApplicationRole;
    displayName: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    phoneNumber?: string;
    businessType?: string;
    websiteUrl?: string;
    description: string;
    categories?: string[];
    operatingLocations?: string[];
    profileData?: Record<string, unknown>;
    status: ApplicationStatus;
    reviewNote?: string;
    reviewedAt?: string;
    rejectionCount?: number;
    blockedAt?: string | null;
    blockedReason?: string | null;
    mustChangePassword: boolean;
    history?: Array<{ status: ApplicationStatus | 'UNBLOCKED'; at: string; note?: string }>;
}

export type ProductType =
    | 'PHYSICAL'
    | 'PERISHABLE'
    | 'DIGITAL'
    | 'SERVICE'
    | 'WORKSHOP'
    | 'EXPERIENCE'
    | 'EVENT'
    | 'TICKET';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface NavigationItem {
    label: string;
    href: string;
    icon: string;
    badge?: string;
}

export interface WorkspaceMetric {
    label: string;
    value: string;
    change: string;
    tone?: StatusTone;
}

export interface WorkspaceActivity {
    id: string;
    primary: string;
    secondary: string;
    status: string;
    tone: StatusTone;
    amount?: string;
}

export interface WorkspaceDefinition {
    role: MarketplaceRole;
    eyebrow: string;
    title: string;
    description: string;
    primaryAction: string;
    primaryActionIcon: string;
    navigation: NavigationItem[];
    metrics: WorkspaceMetric[];
    activityTitle: string;
    activityColumns: string[];
    activity: WorkspaceActivity[];
    queueTitle: string;
    queue: Array<{ label: string; value: string; detail: string; tone: StatusTone }>;
}

export interface ProductSummary {
    id: string;
    slug: string;
    name: string;
    vendor: string;
    vendorSlug: string;
    category: string;
    type: ProductType;
    image: string;
    price: number;
    compareAtPrice?: number;
    rating: number;
    reviewCount: number;
    location: string;
    badge?: string;
    vendorProfileId?: string;
    defaultVariantId?: string;
    defaultVariantName?: string;
    defaultVariantSku?: string;
    availableStock?: number;
}
