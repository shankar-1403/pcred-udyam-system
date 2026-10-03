/** Visitor IP: Firebase Hosting's CDN sets fastly-client-ip; otherwise the first x-forwarded-for entry. */
export function clientIp(headers) {
    const cdn = headers.get('fastly-client-ip')?.trim();
    if (cdn)
        return cdn;
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
        const first = forwarded.split(',')[0]?.trim();
        if (first)
            return first;
    }
    return headers.get('x-real-ip')?.trim() || 'unknown';
}
/** UDYAM_ALLOWED_ORIGINS ("https://a.example, https://b.example") as a normalised list. */
export function allowedOriginList(value) {
    return value
        .split(',')
        .map((o) => o.trim().toLowerCase().replace(/\/+$/, ''))
        .filter(Boolean);
}
/**
 * Browser calls must come from this site (the Firebase Hosting domain the request arrived on)
 * or an origin listed in UDYAM_ALLOWED_ORIGINS, so other websites cannot spend your Cashfree
 * balance through visitors' browsers. Requests without an Origin header (not from a browser)
 * are left to the rate limiter.
 */
export function isAllowedOrigin(headers, allowedList = process.env.UDYAM_ALLOWED_ORIGINS ?? '') {
    const origin = headers.get('origin');
    if (!origin)
        return true;
    let originHost;
    try {
        originHost = new URL(origin).host.toLowerCase();
    }
    catch {
        return false;
    }
    const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0].trim().toLowerCase();
    if (host && originHost === host)
        return true;
    return allowedOriginList(allowedList).includes(origin.toLowerCase().replace(/\/+$/, ''));
}
