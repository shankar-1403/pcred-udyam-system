import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { handleVerifyRequest } from '../src/handler.js';
import { handleCheckoutRequest, handleUnlockRequest } from '../src/payments/handler.js';
import { openRecord, sealHash, sealRecord, sealTagMatches } from '../src/payments/seal.js';
import { publicPreview } from '../src/payments/preview.js';
import { UDYAM_NUMBER_PRICE_INR } from '../src/payments/price.js';
import { apiRoute } from '../src/server/route.js';

const record = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/udyam-success.normalized.json'), 'utf8'));
const SECRET = 'test-seal-secret';
const allow = { check: () => ({ allowed: true, retryAfterSeconds: 0 }) };

function request(path, body, headers = {}) {
    return {
        method: 'POST',
        path,
        url: path,
        headers: new Headers({
            'content-type': 'application/json',
            origin: 'https://pcred-udyam-system.web.app',
            'x-forwarded-host': 'pcred-udyam-system.web.app',
            ...headers,
        }),
        rawBody: JSON.stringify(body),
    };
}

const deps = {
    loadSealSecret: () => SECRET,
    loadPgConfig: () => ({ clientId: 'pg_id', clientSecret: 'pg_secret' }),
    limiter: allow,
};

describe('report seal', () => {
    it('round-trips the record and hides it from the ciphertext', () => {
        const sealed = sealRecord(record, SECRET, 1_000);
        expect(sealed).not.toContain('Shed No. 12');
        expect(sealed).not.toContain(record.enterprise_name);
        expect(openRecord(sealed, SECRET, 1_000).record.udyam_number).toBe(record.udyam_number);
        expect(openRecord(sealed, SECRET, 1_000).amount).toBeNull();
        expect(openRecord(sealRecord(record, SECRET, 1_000, 499), SECRET, 1_000).amount).toBe(499);
    });
    it('rejects a tampered seal, the wrong key, and an expired seal', () => {
        const sealed = sealRecord(record, SECRET, 1_000);
        const parts = sealed.split('.');
        parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
        expect(openRecord(sealed, 'other', 1_000).reason).toBe('invalid');
        expect(openRecord(parts.join('.'), SECRET, 1_000).reason).toBe('invalid');
        expect(openRecord(sealed, SECRET, 1_000 + 31 * 60 * 1000).reason).toBe('expired');
    });
    it('matches only the tag for this seal', () => {
        const sealed = sealRecord(record, SECRET, 1_000);
        expect(sealTagMatches(sealed, sealHash(sealed))).toBe(true);
        expect(sealTagMatches(sealed, sealHash('other'))).toBe(false);
    });
});

describe('public preview', () => {
    it('keeps the confirmation fields and drops the address, phone and certificate', () => {
        expect(publicPreview(record)).toEqual({
            enterprise_name: 'SHREE GANESH ENGINEERING WORKS',
            udyam_number: 'UDYAM-MH-26-0012345',
            enterprise_type: 'Micro',
            major_activity: 'Manufacturing',
            organization_type: 'Proprietary',
            district: 'PUNE',
            state: 'MAHARASHTRA',
        });
    });
});

describe('api routes', () => {
    it('tells verify, checkout and unlock apart', () => {
        expect(apiRoute({ path: '/api/udyam/verify' })).toBe('verify');
        expect(apiRoute({ path: '/api/udyam/checkout' })).toBe('checkout');
        expect(apiRoute({ path: '/checkout' })).toBe('checkout');
        expect(apiRoute({ url: '/api/udyam/unlock?order_id=1' })).toBe('unlock');
        expect(apiRoute({ path: '/' })).toBe('verify');
        expect(apiRoute({ path: '/api/udyam/otp/send' })).toBe('otp-send');
        expect(apiRoute({ path: '/otp/verify' })).toBe('otp-verify');
        expect(apiRoute({ path: '/api/udyam/certificate' })).toBe('certificate');
        expect(apiRoute({ path: '/api/udyam/lead' })).toBe('lead');
        expect(apiRoute({ path: '/lead' })).toBe('lead');
        expect(apiRoute({ path: '/api/udyam/verify' })).toBe('verify');
    });
});

describe('payment handlers', () => {
    it('verify returns a preview and a seal, not the full record', async () => {
        const res = await handleVerifyRequest(request('/api/udyam/verify', { udyam: record.udyam_number }), {
            ...deps,
            loadConfig: () => ({}),
            verify: async () => ({ ok: true, record }),
        });
        expect(res.status).toBe(200);
        expect(res.body.data).toBeUndefined();
        expect(res.body.preview.enterprise_name).toBe(record.enterprise_name);
        expect(res.body.price).toEqual({ amount: UDYAM_NUMBER_PRICE_INR, currency: 'INR' });
        expect(res.body.sealed).not.toContain('Shed No. 12');
        expect(openRecord(res.body.sealed, SECRET).record.split_address.flat).toBe('Shed No. 12');
    });

    it('checkout asks Cashfree for the fixed price and does not send the Udyam record', async () => {
        const sealed = sealRecord(record, SECRET, Date.now(), UDYAM_NUMBER_PRICE_INR);
        const calls = [];
        const fetchImpl = vi.fn(async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ payment_session_id: 'session_1', order_id: 'ignored' }), { status: 200 });
        });
        const res = await handleCheckoutRequest(request('/api/udyam/checkout', { sealed, phone: '98765 43210' }), { ...deps, fetchImpl });
        expect(res.status).toBe(200);
        expect(res.body.payment_session_id).toBe('session_1');
        expect(res.body.order_id).toMatch(/^pcred_pay_[a-z0-9]{16}$/);
        const sent = JSON.parse(calls[0].init.body);
        expect(calls[0].url).toBe('https://api.cashfree.com/pg/orders');
        expect(calls[0].init.headers['x-client-id']).toBe('pg_id');
        expect(sent.order_amount).toBe(UDYAM_NUMBER_PRICE_INR);
        expect(sent.order_currency).toBe('INR');
        expect(sent.customer_details.customer_phone).toBe('9876543210');
        expect(sent.order_tags.seal).toBe(sealHash(sealed));
        expect(sent.order_meta.return_url).toBe('https://pcred-udyam-system.web.app/?order_id={order_id}');
        expect(JSON.stringify(sent)).not.toContain(record.udyam_number);
        expect(JSON.stringify(sent)).not.toContain('Shed No. 12');
    });

    it('rejects a bad phone and an expired preview', async () => {
        const sealed = sealRecord(record, SECRET, 1_000);
        const badPhone = await handleCheckoutRequest(request('/api/udyam/checkout', { sealed, phone: '123' }), deps);
        expect(badPhone.status).toBe(400);
        expect(badPhone.body.error.code).toBe('INVALID_PHONE');
        const expired = await handleCheckoutRequest(request('/api/udyam/checkout', { sealed, phone: '9876543210' }), { ...deps, now: () => 1_000 + 31 * 60 * 1000 });
        expect(expired.body.error.code).toBe('PREVIEW_EXPIRED');
        const unpriced = sealRecord(record, SECRET);
        const missingPrice = await handleCheckoutRequest(request('/api/udyam/checkout', { sealed: unpriced, phone: '9876543210' }), deps);
        expect(missingPrice.status).toBe(400);
        expect(missingPrice.body.error.code).toBe('BAD_REQUEST');
    });

    it('unlocks only a paid order whose tag matches this seal', async () => {
        const sealed = sealRecord(record, SECRET, Date.now(), UDYAM_NUMBER_PRICE_INR);
        const tag = sealHash(sealed);
        const paid = {
            order_status: 'PAID',
            order_amount: UDYAM_NUMBER_PRICE_INR,
            order_currency: 'INR',
            order_tags: { seal: tag },
        };
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify(paid), { status: 200 }));
        const res = await handleUnlockRequest(request('/api/udyam/unlock', { order_id: 'pcred_pay_0123456789abcdef', sealed }), { ...deps, fetchImpl });
        expect(res.status).toBe(200);
        expect(res.body.data.enterprise_name).toBe(record.enterprise_name);
        expect(res.body.data.split_address.flat).toBe('Shed No. 12');

        const unpaid = await handleUnlockRequest(request('/api/udyam/unlock', { order_id: 'pcred_pay_0123456789abcdef', sealed }), {
            ...deps,
            fetchImpl: vi.fn(async (url) => new Response(JSON.stringify(url.endsWith('/payments') ? [] : { ...paid, order_status: 'ACTIVE' }), { status: 200 })),
        });
        expect(unpaid.status).toBe(402);

        const mismatch = await handleUnlockRequest(request('/api/udyam/unlock', { order_id: 'pcred_pay_0123456789abcdef', sealed }), {
            ...deps,
            fetchImpl: vi.fn(async () => new Response(JSON.stringify({ ...paid, order_tags: { seal: 'nope' } }), { status: 200 })),
        });
        expect(mismatch.status).toBe(400);
    });
});
