import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testKeyPair } from './helpers.js';

vi.mock('firebase-admin/app', () => ({
    getApps: () => [],
    initializeApp: () => ({}),
}));
vi.mock('firebase-admin/database', () => ({
    ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } },
    getDatabase: () => ({
        ref() {
            return {
                push: async () => ({}),
                orderByChild() { return this; },
                equalTo() { return this; },
                endAt() { return this; },
                get: async () => ({ forEach() {} }),
                update: async () => {},
            };
        },
    }),
}));
// The deployed entry point: secrets → config, Express-style req/res → handler.
const keys = testKeyPair();
beforeAll(() => {
    process.env.CASHFREE_CLIENT_ID = 'CF_PROD_CLIENT';
    process.env.CASHFREE_CLIENT_SECRET = 'cfsk_ma_prod_SECRET';
    process.env.CASHFREE_PUBLIC_KEY = keys.publicPem;
});
afterAll(() => {
    delete process.env.CASHFREE_CLIENT_ID;
    delete process.env.CASHFREE_CLIENT_SECRET;
    delete process.env.CASHFREE_PUBLIC_KEY;
    vi.restoreAllMocks();
});
function fakeRes() {
    const res = {
        statusCode: 0,
        headers: {},
        payload: undefined,
        ended: false,
        status(code) { res.statusCode = code; return res; },
        set(h) { Object.assign(res.headers, h); return res; },
        json(body) { res.payload = body; res.ended = true; return res; },
        end() { res.ended = true; return res; },
    };
    return res;
}
describe('udyamVerify (Cloud Function entry point)', () => {
    it('is an HTTPS function in asia-south1 bound to the Cashfree secrets', async () => {
        const { udyamVerify } = await import('../index.js');
        const endpoint = udyamVerify.__endpoint;
        expect(endpoint.region).toEqual(['asia-south1']);
        expect(endpoint.httpsTrigger).toBeDefined();
        const secrets = endpoint.secretEnvironmentVariables.map((s) => s.key).sort();
        expect(secrets).toEqual(['CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET', 'CASHFREE_PG_CLIENT_ID', 'CASHFREE_PG_CLIENT_SECRET', 'CASHFREE_PUBLIC_KEY', 'FAST2SMS_API_KEY']);
    });
    it('calls Cashfree production with the secrets and returns the handler response', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => { });
        const calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ status: 'UDYAM_NOT_FOUND', reference_id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
        }));
        const { udyamVerify } = await import('../index.js');
        const res = fakeRes();
        const body = JSON.stringify({ udyam: 'UDYAM-MH-26-0012345' });
        await udyamVerify({
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'https://reports.pcred.in', 'x-forwarded-host': 'reports.pcred.in', 'x-forwarded-for': '203.0.113.5' },
            rawBody: Buffer.from(body),
            body: JSON.parse(body),
        }, res);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://api.cashfree.com/verification/udyam');
        const h = calls[0].init.headers;
        expect(h['x-client-id']).toBe('CF_PROD_CLIENT');
        expect(h['x-client-secret']).toBe('cfsk_ma_prod_SECRET');
        expect(h['x-cf-signature']).toBeTruthy();
        expect(res.statusCode).toBe(404);
        expect(res.headers['Cache-Control']).toBe('no-store');
        expect(res.payload).toMatchObject({ ok: false, error: { code: 'UDYAM_NOT_FOUND', message: 'Udyam Registration Number not found' } });
        vi.unstubAllGlobals();
    });
});
