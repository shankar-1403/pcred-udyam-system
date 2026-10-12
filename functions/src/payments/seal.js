import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const TTL_MS = 30 * 60 * 1000;

function keyFrom(secret) {
    return createHash('sha256').update(`pcred-udyam-seal:${secret}`).digest();
}

/** Encrypts the full Udyam record so the browser can hold it without being able to read it. `amount` is the price this seal may be paid at. */
export function sealRecord(record, secret, now = Date.now(), amount = null) {
    if (!secret)
        throw new Error('seal secret missing');
    const iv = randomBytes(12);
    const payload = Buffer.from(JSON.stringify({ exp: now + TTL_MS, record, amount }), 'utf8');
    const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
    const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

/** Opens a seal. `reason` is `expired` or `invalid`. */
export function openRecord(sealed, secret, now = Date.now()) {
    try {
        if (!secret || typeof sealed !== 'string')
            return { ok: false, reason: 'invalid' };
        const parts = sealed.split('.');
        if (parts.length !== 4 || parts[0] !== VERSION)
            return { ok: false, reason: 'invalid' };
        const iv = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        const enc = Buffer.from(parts[3], 'base64url');
        if (iv.length !== 12 || tag.length !== 16 || enc.length === 0)
            return { ok: false, reason: 'invalid' };
        const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
        decipher.setAuthTag(tag);
        const json = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
        const payload = JSON.parse(json);
        if (!payload || typeof payload.exp !== 'number' || !payload.record || typeof payload.record !== 'object')
            return { ok: false, reason: 'invalid' };
        if (now > payload.exp)
            return { ok: false, reason: 'expired' };
        const amount = typeof payload.amount === 'number' ? payload.amount : null;
        return { ok: true, record: payload.record, amount };
    }
    catch {
        return { ok: false, reason: 'invalid' };
    }
}

/** Short tag stored on the Cashfree order so one payment can unlock only this seal. */
export function sealHash(sealed) {
    return createHash('sha256').update(String(sealed)).digest('hex').slice(0, 32);
}

export function sealTagMatches(sealed, tag) {
    const expected = Buffer.from(sealHash(sealed));
    const got = Buffer.from(String(tag ?? ''));
    if (expected.length !== got.length)
        return false;
    return timingSafeEqual(expected, got);
}
