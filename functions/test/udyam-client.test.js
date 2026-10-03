import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyUdyam, newVerificationId, USER_MESSAGES } from '../src/cashfree/udyam-client.js';
import { CASHFREE_UDYAM_URL } from '../src/cashfree/config.js';
import { decryptSignature, testKeyPair } from './helpers.js';
const URN = 'UDYAM-MH-26-0012345';
const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/udyam-success.json'), 'utf8'));
const keys = testKeyPair();
const config = { clientId: 'CF_PROD_CLIENT', clientSecret: 'cfsk_ma_prod_SECRET_VALUE', publicKey: keys.publicKey };
function fakeFetch(...responses) {
    const calls = [];
    const impl = vi.fn(async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        const next = responses.shift();
        if (!next)
            throw new Error('no more fake responses');
        if (next instanceof Error)
            throw next;
        return typeof next === 'function' ? next() : next;
    });
    return { impl: impl, calls };
}
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let logs = [];
beforeEach(() => {
    logs = [];
    for (const m of ['info', 'warn', 'error'])
        vi.spyOn(console, m).mockImplementation((line) => { logs.push(String(line)); });
});
afterEach(() => vi.restoreAllMocks());
describe('verifyUdyam: request', () => {
    it('POSTs the exact body and headers to the production endpoint', async () => {
        const { impl, calls } = fakeFetch(jsonRes(200, raw));
        const before = Math.floor(Date.now() / 1000);
        const r = await verifyUdyam(URN, { fetchImpl: impl, config });
        expect(r.ok).toBe(true);
        expect(calls).toHaveLength(1);
        const { url, init } = calls[0];
        expect(url).toBe('https://api.cashfree.com/verification/udyam');
        expect(url).toBe(CASHFREE_UDYAM_URL);
        expect(init.method).toBe('POST');
        const h = init.headers;
        expect(h['Content-Type']).toBe('application/json');
        expect(h['x-client-id']).toBe('CF_PROD_CLIENT');
        expect(h['x-client-secret']).toBe('cfsk_ma_prod_SECRET_VALUE');
        const [id, ts] = decryptSignature(h['x-cf-signature'], keys.privateKey).split('.');
        expect(id).toBe('CF_PROD_CLIENT');
        expect(Number(ts)).toBeGreaterThanOrEqual(before);
        expect(Number(ts)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
        const body = JSON.parse(String(init.body));
        expect(Object.keys(body)).toEqual(['verification_id', 'udyam']);
        expect(body.udyam).toBe(URN);
        expect(body.verification_id).toMatch(/^[A-Za-z0-9._-]{1,50}$/);
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });
    it('omits x-cf-signature when no public key is configured (IP-whitelist 2FA)', async () => {
        const { impl, calls } = fakeFetch(jsonRes(200, raw));
        await verifyUdyam(URN, { fetchImpl: impl, config: { ...config, publicKey: null } });
        expect(calls[0].init.headers).not.toHaveProperty('x-cf-signature');
    });
    it('generates a new, valid verification_id for every request', () => {
        const ids = new Set(Array.from({ length: 500 }, () => newVerificationId()));
        expect(ids.size).toBe(500);
        for (const id of ids)
            expect(id).toMatch(/^[A-Za-z0-9._-]{1,50}$/);
    });
});
describe('verifyUdyam: Cashfree statuses', () => {
    it('SUCCESS returns the cleaned record', async () => {
        const { impl } = fakeFetch(jsonRes(200, raw));
        const r = await verifyUdyam(URN, { fetchImpl: impl, config });
        expect(r).toMatchObject({ ok: true, record: { udyam_number: URN, enterprise_name: 'SHREE GANESH ENGINEERING WORKS', reference_id: '3478283' } });
    });
    it('UDYAM_NOT_FOUND and UDYAM_IS_CANCELLED map to the agreed messages', async () => {
        const nf = await verifyUdyam(URN, { fetchImpl: fakeFetch(jsonRes(200, { status: 'UDYAM_NOT_FOUND', verification_id: 'x', reference_id: 1 })).impl, config });
        expect(nf).toMatchObject({ ok: false, httpStatus: 404, code: 'UDYAM_NOT_FOUND', message: 'Udyam Registration Number not found' });
        const c = await verifyUdyam(URN, { fetchImpl: fakeFetch(jsonRes(200, { status: 'UDYAM_IS_CANCELLED' })).impl, config });
        expect(c).toMatchObject({ ok: false, httpStatus: 410, code: 'UDYAM_IS_CANCELLED', message: 'This Udyam registration has been cancelled' });
    });
});
describe('verifyUdyam: errors', () => {
    const cases = [
        ['invalid client id/secret', jsonRes(401, { type: 'authentication_error', code: 'authentication_failed', message: 'Invalid clientId and clientSecret combination' }), 503, 'SERVICE_UNAVAILABLE', 'invalid_client_credentials'],
        ['missing client id', jsonRes(400, { type: 'validation_error', code: 'x-client-id_missing', message: 'x-client-id is missing in the request' }), 503, 'SERVICE_UNAVAILABLE', 'client_credentials_rejected'],
        ['test-environment secret', jsonRes(400, { type: 'validation_error', code: 'x-client-secret_value_invalid', message: 'Client secret belongs to test environment' }), 503, 'SERVICE_UNAVAILABLE', 'client_credentials_rejected'],
        ['IP not whitelisted', jsonRes(403, { type: 'authentication_error', code: 'ip_validation_failed', message: 'IP not whitelisted your current ip is 203.0.113.45' }), 503, 'SERVICE_UNAVAILABLE', 'ip_not_whitelisted'],
        ['signature missing', jsonRes(403, { type: 'authentication_error', code: 'authentication_failed', message: 'x-cf-signature missing in the request header' }), 503, 'SERVICE_UNAVAILABLE', 'signature_rejected'],
        ['signature expired', jsonRes(403, { type: 'authentication_error', code: 'authentication_failed', message: 'Signature expired' }), 503, 'SERVICE_UNAVAILABLE', 'signature_rejected'],
        ['invalid udyam', jsonRes(400, { type: 'validation_error', code: 'udyam_value_invalid', message: 'udyam is invalid' }), 400, 'INVALID_UDYAM', 'udyam_rejected'],
        ['verification id rejected', jsonRes(400, { type: 'validation_error', code: 'verification_id_value_invalid', message: 'verification_id can include only alphanum, dot, hyphen and underscores' }), 502, 'UPSTREAM_ERROR', 'verification_id_rejected'],
        ['insufficient balance', jsonRes(422, { type: 'validation_error', code: 'insufficient_balance', message: 'Insufficient balance to process this request' }), 503, 'SERVICE_UNAVAILABLE', 'insufficient_balance'],
        ['rate limit per operation', jsonRes(429, { type: 'rate_limit_error', code: 'too_many_requests_per_operation', message: 'Too many requests for this operation' }), 429, 'RATE_LIMITED', 'too_many_requests_per_operation'],
        ['rate limit per IP', jsonRes(429, { type: 'rate_limit_error', code: 'too_many_requests_per_ip', message: 'Too many requests from the IP, rate limit reached' }), 429, 'RATE_LIMITED', 'too_many_requests_per_ip'],
        ['Cashfree 500', jsonRes(500, { type: 'internal_error', code: 'verification_failed', message: 'something went wrong' }), 502, 'UPSTREAM_ERROR', 'cashfree_500'],
        ['Cashfree 502', jsonRes(502, { type: 'internal_error', code: 'verification_failed', message: 'verification attempt failed' }), 502, 'UPSTREAM_ERROR', 'cashfree_502'],
        ['non-JSON 200', new Response('<html>gateway</html>', { status: 200 }), 502, 'BAD_RESPONSE', 'malformed_body'],
        ['empty 200', new Response('', { status: 200 }), 502, 'BAD_RESPONSE', 'malformed_body'],
        ['SUCCESS without data', jsonRes(200, { status: 'SUCCESS' }), 502, 'BAD_RESPONSE', 'unexpected_status'],
        ['unknown status', jsonRes(200, { status: 'PENDING' }), 502, 'BAD_RESPONSE', 'unexpected_status'],
    ];
    for (const [name, res, httpStatus, code, reason] of cases) {
        it(`${name} → ${httpStatus} ${code}`, async () => {
            const r = await verifyUdyam(URN, { fetchImpl: fakeFetch(res).impl, config });
            expect(r).toMatchObject({ ok: false, httpStatus, code });
            if (!r.ok) {
                expect(r.message).toBe(USER_MESSAGES[code]);
                expect(r.reference).toMatch(/^pcred_udyam_/);
            }
            expect(logs.join('\n')).toContain(`"reason":"${reason}"`);
        });
    }
    it('logs the egress IP Cashfree reports, so it can be whitelisted', async () => {
        await verifyUdyam(URN, { fetchImpl: fakeFetch(jsonRes(403, { code: 'ip_validation_failed', message: 'IP not whitelisted your current ip is 203.0.113.45' })).impl, config });
        expect(logs.join('\n')).toContain('"egress_ip":"203.0.113.45"');
    });
    it('retries once with a new verification_id after "verification ID already exists"', async () => {
        const { impl, calls } = fakeFetch(jsonRes(409, { code: 'verification_id_already_exists', message: 'verification ID already exists' }), jsonRes(200, raw));
        const r = await verifyUdyam(URN, { fetchImpl: impl, config });
        expect(r.ok).toBe(true);
        expect(calls).toHaveLength(2);
        const [a, b] = calls.map((c) => JSON.parse(String(c.init.body)).verification_id);
        expect(a).not.toBe(b);
    });
    it('gives up after a second duplicate id', async () => {
        const dup = () => jsonRes(409, { code: 'verification_id_already_exists' });
        const r = await verifyUdyam(URN, { fetchImpl: fakeFetch(dup(), dup()).impl, config });
        expect(r).toMatchObject({ ok: false, httpStatus: 502, code: 'UPSTREAM_ERROR' });
    });
    it('times out slow requests', async () => {
        const slow = (_u, init) => new Promise((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(init.signal.reason));
        });
        const r = await verifyUdyam(URN, { fetchImpl: slow, config, timeoutMs: 50 });
        expect(r).toMatchObject({ ok: false, httpStatus: 504, code: 'TIMEOUT', message: USER_MESSAGES.TIMEOUT });
    });
    it('reports network failures', async () => {
        const r = await verifyUdyam(URN, { fetchImpl: fakeFetch(new TypeError('fetch failed')).impl, config });
        expect(r).toMatchObject({ ok: false, httpStatus: 502, code: 'NETWORK_ERROR' });
    });
    it('reports missing configuration without calling Cashfree', async () => {
        const saved = { id: process.env.CASHFREE_CLIENT_ID, secret: process.env.CASHFREE_CLIENT_SECRET };
        delete process.env.CASHFREE_CLIENT_ID;
        delete process.env.CASHFREE_CLIENT_SECRET;
        const { impl, calls } = fakeFetch(jsonRes(200, raw));
        const r = await verifyUdyam(URN, { fetchImpl: impl });
        expect(r).toMatchObject({ ok: false, httpStatus: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(calls).toHaveLength(0);
        expect(logs.join('\n')).toContain('"reason":"config_missing"');
        if (saved.id)
            process.env.CASHFREE_CLIENT_ID = saved.id;
        if (saved.secret)
            process.env.CASHFREE_CLIENT_SECRET = saved.secret;
    });
});
describe('logging', () => {
    it('never logs credentials, the signature or personal details', async () => {
        const { impl, calls } = fakeFetch(jsonRes(200, raw), jsonRes(401, { code: 'authentication_failed', message: 'Invalid clientId and clientSecret combination' }));
        await verifyUdyam(URN, { fetchImpl: impl, config });
        await verifyUdyam(URN, { fetchImpl: impl, config });
        const all = logs.join('\n');
        const sig = calls[0].init.headers['x-cf-signature'];
        for (const secret of [config.clientSecret, sig, 'SHREE GANESH', 'ga******@gmail.com', '98*****210', 'Bhosari', URN]) {
            expect(all).not.toContain(secret);
        }
        expect(all).toContain('UDYAM-MH-26-****345');
    });
});
