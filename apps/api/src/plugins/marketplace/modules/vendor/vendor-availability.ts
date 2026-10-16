export interface MarketplaceVendorWeeklyHours {
    dayOfWeek: number;
    enabled: boolean;
    opensAt: string;
    closesAt: string;
}

export interface MarketplaceVendorUnavailableDate {
    id: string;
    date: string;
    reason: string;
}

export interface MarketplaceVendorAvailabilitySource {
    availabilityPaused?: boolean;
    availabilityPauseReason?: string;
    availabilityTimezone?: string;
    weeklyHours?: MarketplaceVendorWeeklyHours[];
    unavailableDates?: MarketplaceVendorUnavailableDate[];
    holidayModeEnabled?: boolean;
    holidayStartsAt?: Date;
    holidayEndsAt?: Date;
    holidayReason?: string;
}

export type MarketplaceVendorAvailabilityStatus =
    | 'OPEN'
    | 'CLOSED'
    | 'PAUSED'
    | 'HOLIDAY'
    | 'SPECIAL_CLOSURE';

export interface MarketplaceVendorAvailability {
    status: MarketplaceVendorAvailabilityStatus;
    isOpen: boolean;
    acceptsPerishableOrders: boolean;
    label: string;
    reason?: string;
    timezone: string;
    currentDate: string;
    todayHours?: string;
    weeklyHours: MarketplaceVendorWeeklyHours[];
}

const DEFAULT_TIMEZONE = 'Asia/Karachi';
const DAY_KEYS: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

export function defaultMarketplaceWeeklyHours(): MarketplaceVendorWeeklyHours[] {
    return Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        enabled: true,
        opensAt: '00:00',
        closesAt: '23:59',
    }));
}

export function getMarketplaceVendorAvailability(
    vendor: MarketplaceVendorAvailabilitySource,
    now = new Date(),
): MarketplaceVendorAvailability {
    const timezone = validTimezone(vendor.availabilityTimezone) ? vendor.availabilityTimezone! : DEFAULT_TIMEZONE;
    const local = localDateParts(now, timezone);
    const weeklyHours = effectiveWeeklyHours(vendor.weeklyHours);
    const today = weeklyHours.find(item => item.dayOfWeek === local.dayOfWeek);
    const base = {
        timezone,
        currentDate: local.date,
        todayHours: today?.enabled ? `${formatClock(today.opensAt)} - ${formatClock(today.closesAt)}` : undefined,
        weeklyHours,
    };

    if (vendor.availabilityPaused) {
        return closedAvailability('PAUSED', 'Temporarily paused', vendor.availabilityPauseReason, base);
    }

    if (vendor.holidayModeEnabled && dateIsActive(now, vendor.holidayStartsAt, vendor.holidayEndsAt)) {
        return closedAvailability('HOLIDAY', 'Holiday mode', vendor.holidayReason, base);
    }

    const specialClosure = (vendor.unavailableDates ?? []).find(item => item.date === local.date);
    if (specialClosure) {
        return closedAvailability('SPECIAL_CLOSURE', 'Closed today', specialClosure.reason, base);
    }

    if (!isInsideWeeklyHours(weeklyHours, local.dayOfWeek, local.minutes)) {
        return closedAvailability('CLOSED', 'Closed now', 'Outside regular opening hours', base);
    }

    return {
        status: 'OPEN',
        isOpen: true,
        acceptsPerishableOrders: true,
        label: 'Open now',
        ...base,
    };
}

function effectiveWeeklyHours(value?: MarketplaceVendorWeeklyHours[]) {
    const defaults = defaultMarketplaceWeeklyHours();
    if (!Array.isArray(value) || !value.length) return defaults;
    return defaults.map(fallback => {
        const configured = value.find(item => item.dayOfWeek === fallback.dayOfWeek);
        return configured ? { ...configured } : fallback;
    });
}

function isInsideWeeklyHours(hours: MarketplaceVendorWeeklyHours[], dayOfWeek: number, minutes: number) {
    const today = hours.find(item => item.dayOfWeek === dayOfWeek);
    if (today?.enabled) {
        const opens = timeToMinutes(today.opensAt);
        const closes = timeToMinutes(today.closesAt);
        if (opens < closes && minutes >= opens && minutes < closes) return true;
        if (opens > closes && minutes >= opens) return true;
    }

    const previous = hours.find(item => item.dayOfWeek === (dayOfWeek + 6) % 7);
    if (!previous?.enabled) return false;
    const previousOpens = timeToMinutes(previous.opensAt);
    const previousCloses = timeToMinutes(previous.closesAt);
    return previousOpens > previousCloses && minutes < previousCloses;
}

function localDateParts(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
    return {
        date: `${part('year')}-${part('month')}-${part('day')}`,
        dayOfWeek: DAY_KEYS[part('weekday')] ?? 0,
        minutes: Number(part('hour')) * 60 + Number(part('minute')),
    };
}

function closedAvailability(
    status: Exclude<MarketplaceVendorAvailabilityStatus, 'OPEN'>,
    label: string,
    reason: string | undefined,
    base: Pick<MarketplaceVendorAvailability, 'timezone' | 'currentDate' | 'todayHours' | 'weeklyHours'>,
): MarketplaceVendorAvailability {
    return {
        status,
        isOpen: false,
        acceptsPerishableOrders: false,
        label,
        reason,
        ...base,
    };
}

function dateIsActive(now: Date, startsAt?: Date, endsAt?: Date) {
    if (!startsAt || !endsAt) return false;
    return now.getTime() >= new Date(startsAt).getTime() && now.getTime() <= new Date(endsAt).getTime();
}

function timeToMinutes(value: string) {
    const [hours = '0', minutes = '0'] = value.split(':');
    return Number(hours) * 60 + Number(minutes);
}

function formatClock(value: string) {
    const total = timeToMinutes(value);
    const hour = Math.floor(total / 60);
    const minute = total % 60;
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function validTimezone(value?: string) {
    if (!value) return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format();
        return true;
    } catch {
        return false;
    }
}
