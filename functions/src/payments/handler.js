import { createHash, randomBytes } from 'node:crypto';
import { REPORT_PRICE_INR } from './price.js';
import { openRecord, sealHash, sealTagMatches } from './seal.js';
import { createPaymentOrder, readPaymentOrder } from './gateway.js';
import { RateLimiter } from '../server/rate-limit.js';
import { allowedOriginList, clientIp, isAllowedOrigin } from '../server/request.js';
import { logEvent } from '../server/log.js';

export const MAX_PAY_BODY_BYTES = 80_000;
const payLimiter = new RateLimiter(10, 40);
const PHONE = /^[6-9]\d{9}$/;
const ORDER_ID = /^pcred_pay_[a-z0-9]{16}$/;

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

function siteOrigin(headers) {
    const origin = headers.get('origin');
    if (origin && /^https:\/\//i.test(origin))
        return origin.replace(/\/+$/, '');
    const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0].trim();
    if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1'))
        return `https://${host}`;
    return 'https://pcred-udyam-system.web.app';
}

function guard(req, deps) {
    const allowed = deps.allowedOrigins ?? process.env.UDYAM_ALLOWED_ORIGINS ?? '';
    const cors = corsHeaders(req.headers, allowed);
    const reply = (status, body, extra = {}) => ({
        status,
        headers: { 'Cache-Control': 'no-store', ...cors, ...extra },
        body,
    });
    const failure = (code, message, status, extra = {}) => reply(status, { ok: false, error: { code, message } }, extra.headers);
    if (req.method === 'OPTIONS')
        return { done: reply(Object.keys(cors).length ? 204 : 403, null) };
    if (req.method !== 'POST')
        return { done: failure('BAD_REQUEST', 'Use POST.', 405, { headers: { Allow: 'POST' } }) };
    if (!isAllowedOrigin(req.headers, allowed))
        return { done: failure('FORBIDDEN', 'This request is not allowed.', 403) };
    if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json'))
        return { done: failure('BAD_REQUEST', 'Send the request as JSON.', 415) };
    if (Buffer.byteLength(req.rawBody ?? '', 'utf8') > MAX_PAY_BODY_BYTES)
        return { done: failure('BAD_REQUEST', 'The request is too large.', 413) };
    let body;
    try {
        body = JSON.parse(req.rawBody);
    }
    catch {
        return { done: failure('BAD_REQUEST', 'Send the request as JSON.', 400) };
    }
    if (typeof body !== 'object' || body === null)
        return { done: failure('BAD_REQUEST', 'Send the request as JSON.', 400) };
    const limit = (deps.limiter ?? payLimiter).check(clientIp(req.headers));
    if (!limit.allowed)
        return { done: failure('RATE_LIMITED', 'Too many payment requests right now. Please wait a minute and try again.', 429, { headers: { 'Retry-After': String(limit.retryAfterSeconds) } }) };
    return { reply, failure, body };
}

function loadPg(deps, failure) {
    let pg;
    let sealSecret;
    try {
        pg = deps.loadPgConfig();
        sealSecret = deps.loadSealSecret();
    }
    catch (e) {
        logEvent('error', 'udyam_pay', { outcome: 'error', reason: 'config_missing', detail: e instanceof Error ? e.name : 'unknown' });
        return { error: failure('SERVICE_UNAVAILABLE', 'Payment is temporarily unavailable. Please try again later.', 503) };
    }
    if (!pg?.clientId || !pg?.clientSecret || !sealSecret) {
        logEvent('error', 'udyam_pay', { outcome: 'error', reason: 'config_missing' });
        return { error: failure('SERVICE_UNAVAILABLE', 'Payment is temporarily unavailable. Please try again later.', 503) };
    }
    return { pg, sealSecret };
}

function newOrderId() {
    return `pcred_pay_${randomBytes(8).toString('hex')}`;
}

export async function handleCheckoutRequest(req, deps) {
    const gated = guard(req, deps);
    if (gated.done)
        return gated.done;
    const { reply, failure, body } = gated;
    const phone = typeof body.phone === 'string' ? body.phone.replace(/\s+/g, '') : '';
    if (!PHONE.test(phone))
        return failure('INVALID_PHONE', 'Enter a 10-digit Indian mobile number to continue to payment.', 400);
    const sealed = typeof body.sealed === 'string' ? body.sealed : '';
    const loaded = loadPg(deps, failure);
    if (loaded.error)
        return loaded.error;
    const opened = openRecord(sealed, loaded.sealSecret, deps.now?.() ?? Date.now());
    if (!opened.ok) {
        return failure(opened.reason === 'expired' ? 'PREVIEW_EXPIRED' : 'BAD_REQUEST', opened.reason === 'expired'
            ? 'This preview expired. Verify the Udyam number again, then pay.'
            : 'Verify the Udyam number again, then pay.', 400);
    }
    const orderId = newOrderId();
    const created = await createPaymentOrder(loaded.pg, {
        orderId,
        amount: REPORT_PRICE_INR,
        phone,
        customerId: `cust_${createHash('sha256').update(phone).digest('hex').slice(0, 12)}`,
        returnUrl: `${siteOrigin(req.headers)}/?order_id={order_id}`,
        sealTag: sealHash(sealed),
    }, deps.fetchImpl);
    if (!created.ok) {
        logEvent('error', 'udyam_pay', { outcome: 'error', reason: 'order_rejected', cf_http: created.httpStatus, cf_code: created.code });
        return failure('SERVICE_UNAVAILABLE', 'Payment could not be started. Please try again later.', created.httpStatus === 504 ? 504 : 503);
    }
    logEvent('info', 'udyam_pay', { outcome: 'order_created', order_id: orderId });
    return reply(200, { ok: true, order_id: orderId, payment_session_id: created.paymentSessionId, price: { amount: REPORT_PRICE_INR, currency: 'INR' } });
}

export async function handleUnlockRequest(req, deps) {
    const gated = guard(req, deps);
    if (gated.done)
        return gated.done;
    const { reply, failure, body } = gated;
    const orderId = typeof body.order_id === 'string' ? body.order_id : '';
    if (!ORDER_ID.test(orderId))
        return failure('BAD_REQUEST', 'Payment reference is missing. Please try the payment again.', 400);
    const sealed = typeof body.sealed === 'string' ? body.sealed : '';
    const loaded = loadPg(deps, failure);
    if (loaded.error)
        return loaded.error;
    const opened = openRecord(sealed, loaded.sealSecret, deps.now?.() ?? Date.now());
    if (!opened.ok) {
        return failure(opened.reason === 'expired' ? 'PREVIEW_EXPIRED' : 'BAD_REQUEST', opened.reason === 'expired'
            ? 'This preview expired. Verify the Udyam number again. If you were charged, use the same browser to open the payment return link.'
            : 'Verify the Udyam number again, then pay.', 400);
    }
    const payment = await readPaymentOrder(loaded.pg, orderId, deps.fetchImpl);
    if (!payment.ok) {
        logEvent('error', 'udyam_pay', { outcome: 'error', reason: 'order_lookup_failed', order_id: orderId, cf_code: payment.code });
        return failure('SERVICE_UNAVAILABLE', 'Payment could not be confirmed. Please try again in a moment.', payment.httpStatus === 504 ? 504 : 503);
    }
    const tags = payment.order?.order_tags;
    const tag = tags && typeof tags === 'object' ? tags.seal : '';
    const amount = Number(payment.order?.order_amount);
    const currency = payment.order?.order_currency;
    if (!sealTagMatches(sealed, tag) || currency !== 'INR' || Math.abs(amount - REPORT_PRICE_INR) > 0.001) {
        logEvent('warn', 'udyam_pay', { outcome: 'rejected', reason: 'order_mismatch', order_id: orderId });
        return failure('BAD_REQUEST', 'This payment does not match the fetched record. Please pay again.', 400);
    }
    if (!payment.paid) {
        logEvent('info', 'udyam_pay', { outcome: 'unpaid', order_id: orderId, order_status: payment.order?.order_status ?? '' });
        return failure('PAYMENT_PENDING', 'Payment is not complete yet. Finish the payment to view the report.', 402);
    }
    logEvent('info', 'udyam_pay', { outcome: 'unlocked', order_id: orderId });
    return reply(200, { ok: true, data: opened.record });
}
