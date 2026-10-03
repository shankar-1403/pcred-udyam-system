// Fixed-window limits per key (visitor IP), kept in memory. Each Udyam verification is a
// paid Cashfree call, so this stops casual abuse. Every Cloud Functions instance keeps its
// own counters, so maxInstances in index.js also caps the total; add Firebase App Check for
// stronger bot protection.
export class RateLimiter {
    perMinute;
    perDay;
    minute = new Map();
    day = new Map();
    lastSweep = 0;
    constructor(perMinute, perDay) {
        this.perMinute = perMinute;
        this.perDay = perDay;
    }
    check(key, now = Date.now()) {
        this.sweep(now);
        const m = this.bump(this.minute, key, now, 60_000);
        const d = this.bump(this.day, key, now, 86_400_000);
        if (m.count > this.perMinute)
            return { allowed: false, retryAfterSeconds: Math.ceil((m.start + 60_000 - now) / 1000) };
        if (d.count > this.perDay)
            return { allowed: false, retryAfterSeconds: Math.ceil((d.start + 86_400_000 - now) / 1000) };
        return { allowed: true, retryAfterSeconds: 0 };
    }
    bump(map, key, now, size) {
        let w = map.get(key);
        if (!w || now - w.start >= size) {
            w = { start: now, count: 0 };
            map.set(key, w);
        }
        w.count += 1;
        return w;
    }
    sweep(now) {
        if (now - this.lastSweep < 60_000)
            return;
        this.lastSweep = now;
        for (const [k, w] of this.minute)
            if (now - w.start >= 60_000)
                this.minute.delete(k);
        for (const [k, w] of this.day)
            if (now - w.start >= 86_400_000)
                this.day.delete(k);
    }
}
function positiveInt(value, fallback) {
    const n = Number.parseInt(value ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
export const udyamRateLimiter = new RateLimiter(positiveInt(process.env.UDYAM_RATE_LIMIT_PER_MINUTE, 5), positiveInt(process.env.UDYAM_RATE_LIMIT_PER_DAY, 30));
