import { checkUdyamNumber, maskUdyamNumber } from './udyam/validate.js';
import { USER_MESSAGES, verifyUdyam } from './cashfree/udyam-client.js';
import { readCashfreeConfig } from './cashfree/config.js';
import { udyamRateLimiter } from './server/rate-limit.js';
import { allowedOriginList, clientIp, isAllowedOrigin } from './server/request.js';
import { logEvent } from './server/log.js';
import { publicPreview } from './payments/preview.js';
import { UDYAM_NUMBER_PRICE_INR } from './payments/price.js';
import { sealRecord } from './payments/seal.js';
import { readProof } from './intake/otp.js';
import { cachedLeadResponse, rememberLead } from './leads/store.js';
export const MAX_BODY_BYTES = 4096;
// Identical numbers submitted at the same moment share one Cashfree call (each call is billed).
const inflight = new Map();
function corsHeaders(headers, allowed) {
    const origin = headers.get('origin');
    if (!origin || !allowedOriginList(allowed).includes(origin.toLowerCase().replace(/\/+$/, '')))
        return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
    };
}
export async function handleVerifyRequest(req, deps) {
    const allowed = deps.allowedOrigins ?? process.env.UDYAM_ALLOWED_ORIGINS ?? '';
    const cors = corsHeaders(req.headers, allowed);
    const reply = (status, body, extra = {}) => ({
        status,
        headers: { 'Cache-Control': 'no-store', ...cors, ...extra },
        body,
    });
    const failure = (code, message, status, extra = {}) => reply(status, { ok: false, error: { code, message, ...(extra.reference ? { reference: extra.reference } : {}) } }, extra.headers);
    try {
        if (req.method === 'OPTIONS')
            return reply(Object.keys(cors).length ? 204 : 403, null);
        if (req.method !== 'POST')
            return failure('BAD_REQUEST', 'Use POST.', 405, { headers: { Allow: 'POST' } });
        if (!isAllowedOrigin(req.headers, allowed))
            return failure('FORBIDDEN', 'This request is not allowed.', 403);
        if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
            return failure('BAD_REQUEST', 'Send the Udyam Registration Number as JSON.', 415);
        }
        if (Buffer.byteLength(req.rawBody, 'utf8') > MAX_BODY_BYTES)
            return failure('BAD_REQUEST', 'The request is too large.', 413);
        let body;
        try {
            body = JSON.parse(req.rawBody);
        }
        catch {
            return failure('BAD_REQUEST', 'Send the Udyam Registration Number as JSON.', 400);
        }
        const input = typeof body === 'object' && body !== null ? body.udyam : undefined;
        const check = checkUdyamNumber(input);
        if (!check.ok)
            return failure('INVALID_UDYAM', check.message, 400);
        const cached = await cachedLeadResponse(deps.findLead, check.value, deps.now?.() ?? Date.now());
        if (cached)
            return reply(200, cached);
        const limit = (deps.limiter ?? udyamRateLimiter).check(clientIp(req.headers));
        if (!limit.allowed) {
            logEvent('warn', 'udyam_verify', { outcome: 'rate_limited_locally', udyam: maskUdyamNumber(check.value) });
            return failure('RATE_LIMITED', USER_MESSAGES.RATE_LIMITED, 429, { headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
        }
        let pending = inflight.get(check.value);
        if (!pending) {
            pending = runVerify(check.value, deps).finally(() => inflight.delete(check.value));
            inflight.set(check.value, pending);
        }
        const result = await pending;
        if (result.ok) {
            let sealed;
            try {
                sealed = sealRecord(result.record, deps.loadSealSecret(), deps.now?.() ?? Date.now(), UDYAM_NUMBER_PRICE_INR);
            }
            catch (e) {
                logEvent('error', 'udyam_verify', { outcome: 'error', reason: 'seal_failed', detail: e instanceof Error ? e.name : 'unknown' });
                return failure('SERVICE_UNAVAILABLE', USER_MESSAGES.SERVICE_UNAVAILABLE, 503);
            }
            const secret = deps.loadSealSecret();
            const proof = readProof(typeof body.proof === 'string' ? body.proof : '', secret, deps.now?.() ?? Date.now());
            await rememberLead(deps.saveLead, result.record, {
                source: 'udyam_number',
                phone: proof?.phone || '',
                women: body.women,
            });
            return reply(200, {
                ok: true,
                preview: publicPreview(result.record),
                sealed,
                price: { amount: UDYAM_NUMBER_PRICE_INR, currency: 'INR' },
            });
        }
        return failure(result.code, result.message, result.httpStatus, {
            reference: result.reference,
            headers: result.code === 'RATE_LIMITED' ? { 'Retry-After': '60' } : {},
        });
    }
    catch (e) {
        logEvent('error', 'udyam_verify', { outcome: 'error', reason: 'unhandled', detail: e instanceof Error ? e.name : 'unknown' });
        return failure('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.', 500);
    }
}
async function runVerify(udyam, deps) {
    let config;
    try {
        config = deps.loadConfig();
    }
    catch (e) {
        logEvent('error', 'udyam_verify', {
            outcome: 'error', reason: 'config_missing', udyam: maskUdyamNumber(udyam),
            detail: e instanceof Error ? e.message : 'Cashfree configuration could not be loaded',
        });
        return { ok: false, httpStatus: 503, code: 'SERVICE_UNAVAILABLE', message: USER_MESSAGES.SERVICE_UNAVAILABLE };
    }
    return (deps.verify ?? ((u, c) => verifyUdyam(u, { config: c })))(udyam, config);
}
/** Default config loader: Firebase exposes bound secrets as environment variables. */
export const loadConfigFromEnv = () => readCashfreeConfig(process.env);
