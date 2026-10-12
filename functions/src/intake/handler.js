import { RateLimiter } from '../server/rate-limit.js';
import { allowedOriginList, clientIp, isAllowedOrigin } from '../server/request.js';
import { logEvent } from '../server/log.js';
import { publicPreview } from '../payments/preview.js';
import { CERTIFICATE_PRICE_INR } from '../payments/price.js';
import { sealRecord } from '../payments/seal.js';
import { normalizeUdyamSuccess } from '../udyam/normalize.js';
import { checkUdyamNumber } from '../udyam/validate.js';
import { checkOtp, issueOtp, readProof } from './otp.js';
import { sendFast2Sms } from './sms.js';
import { certificateBody } from './certificate.js';
import { cachedLeadResponse, rememberLead } from '../leads/store.js';

const PHONE = /^[6-9]\d{9}$/;
const otpSendLimiter = new RateLimiter(5, 20);
const otpVerifyLimiter = new RateLimiter(8, 40);
const certLimiter = new RateLimiter(10, 30);
const leadLimiter = new RateLimiter(20, 60);

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

function begin(req, deps, maxBytes, limiter) {
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
    if (Buffer.byteLength(req.rawBody ?? '', 'utf8') > maxBytes)
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
    const limit = (deps.limiter ?? limiter).check(clientIp(req.headers));
    if (!limit.allowed)
        return { done: failure('RATE_LIMITED', 'Too many requests right now. Please wait a minute and try again.', 429, { headers: { 'Retry-After': String(limit.retryAfterSeconds) } }) };
    return { reply, failure, body };
}

function phoneOf(body) {
    return typeof body.phone === 'string' ? body.phone.replace(/\s+/g, '') : '';
}

function maskPhone(phone) {
    return PHONE.test(phone) ? `${phone.slice(0, 2)}******${phone.slice(-2)}` : 'invalid';
}

/** Sends the code through Fast2SMS. The emulator (and OTP_DEV_ECHO=1) also returns it for local testing. */
export async function deliverOtp(phone, otp, fetchImpl = fetch, sms = {}) {
    const echo = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.OTP_DEV_ECHO === '1';
    const apiKey = (sms.apiKey || process.env.FAST2SMS_API_KEY || '').trim();
    if (apiKey) {
        const sent = await sendFast2Sms({ apiKey, phone, otp, fetchImpl });
        if (!sent.ok)
            return sent;
    }
    else if (!echo) {
        return { ok: false, reason: 'not_configured' };
    }
    return { ok: true, devCode: echo ? otp : '' };
}

export async function handleOtpSendRequest(req, deps) {
    const gated = begin(req, deps, 2000, otpSendLimiter);
    if (gated.done)
        return gated.done;
    const { reply, failure, body } = gated;
    const phone = phoneOf(body);
    if (!PHONE.test(phone))
        return failure('INVALID_PHONE', 'Enter a 10-digit Indian mobile number.', 400);
    let secret;
    try {
        secret = deps.loadSealSecret();
    }
    catch {
        secret = '';
    }
    if (!secret)
        return failure('SERVICE_UNAVAILABLE', 'The verification code could not be sent. Please try again later.', 503);
    const issued = issueOtp(phone, secret, deps.now?.() ?? Date.now());
    let sms = {};
    try {
        sms = deps.loadSmsConfig?.() ?? {};
    }
    catch {
        sms = {};
    }
    const sent = await deliverOtp(phone, issued.otp, deps.fetchImpl, sms);
    if (!sent.ok) {
        logEvent('error', 'udyam_otp', { outcome: 'error', reason: sent.reason, detail: sent.detail || '', phone: maskPhone(phone) });
        return failure('SERVICE_UNAVAILABLE', 'The verification code could not be sent. Please try again later.', 503);
    }
    logEvent('info', 'udyam_otp', { outcome: 'sent', phone: maskPhone(phone) });
    return reply(200, {
        ok: true,
        challenge: issued.challenge,
        ...(sent.devCode ? { dev_code: sent.devCode } : {}),
    });
}

export async function handleOtpVerifyRequest(req, deps) {
    const gated = begin(req, deps, 4000, otpVerifyLimiter);
    if (gated.done)
        return gated.done;
    const { reply, failure, body } = gated;
    const phone = phoneOf(body);
    const otp = typeof body.otp === 'string' ? body.otp.replace(/\s+/g, '') : '';
    const challenge = typeof body.challenge === 'string' ? body.challenge : '';
    if (!PHONE.test(phone) || !/^\d{6}$/.test(otp) || !challenge)
        return failure('INVALID_OTP', 'Enter the 6-digit code sent to your mobile.', 400);
    let secret;
    try {
        secret = deps.loadSealSecret();
    }
    catch {
        secret = '';
    }
    if (!secret)
        return failure('SERVICE_UNAVAILABLE', 'The code could not be checked. Please try again later.', 503);
    const checked = checkOtp(phone, otp, challenge, secret, deps.now?.() ?? Date.now());
    if (!checked.ok) {
        logEvent('info', 'udyam_otp', { outcome: 'rejected', reason: checked.reason, phone: maskPhone(phone) });
        return failure('INVALID_OTP', checked.reason === 'expired'
            ? 'That code has expired. Send a new one.'
            : 'That code is not correct. Check the message and try again.', 400);
    }
    logEvent('info', 'udyam_otp', { outcome: 'verified', phone: maskPhone(phone) });
    return reply(200, { ok: true, proof: checked.proof });
}

export async function handleCertificateRequest(req, deps) {
    const gated = begin(req, deps, 40_000, certLimiter);
    if (gated.done)
        return gated.done;
    const { reply, failure, body } = gated;
    let secret;
    try {
        secret = deps.loadSealSecret();
    }
    catch {
        secret = '';
    }
    if (!secret)
        return failure('SERVICE_UNAVAILABLE', 'The certificate could not be saved. Please try again later.', 503);
    const now = deps.now?.() ?? Date.now();
    const proof = readProof(typeof body.proof === 'string' ? body.proof : '', secret, now);
    if (!proof)
        return failure('OTP_REQUIRED', 'Verify your mobile number before continuing.', 400);
    const built = certificateBody(body.record);
    if (!built.ok)
        return failure('INVALID_CERTIFICATE', built.message, 400);
    const record = normalizeUdyamSuccess(built.body);
    if (!record)
        return failure('INVALID_CERTIFICATE', 'The certificate details could not be used. Upload a clearer PDF.', 400);
    const cached = await cachedLeadResponse(deps.findLead, record.udyam_number, now);
    if (cached)
        return reply(200, cached);
    let sealed;
    try {
        sealed = sealRecord(record, secret, now, CERTIFICATE_PRICE_INR);
    }
    catch {
        return failure('SERVICE_UNAVAILABLE', 'The certificate could not be saved. Please try again later.', 503);
    }
    logEvent('info', 'udyam_certificate', { outcome: 'sealed' });
    await rememberLead(deps.saveLead, record, {
        source: 'certificate',
        phone: proof.phone,
        women: body.women,
    });
    return reply(200, {
        ok: true,
        preview: publicPreview(record),
        sealed,
        price: { amount: CERTIFICATE_PRICE_INR, currency: 'INR' },
    });
}

/** Looks up a report already saved for this Udyam number. A miss tells the visitor to continue. */
export async function handleLeadRequest(req, deps) {
    const gated = begin(req, deps, 2000, leadLimiter);
    if (gated.done)
        return gated.done;
    const { reply, failure, body } = gated;
    const check = checkUdyamNumber(body.udyam);
    if (!check.ok)
        return failure('INVALID_UDYAM', check.message, 400);
    const cached = await cachedLeadResponse(deps.findLead, check.value, deps.now?.() ?? Date.now());
    if (cached)
        return reply(200, cached);
    return reply(200, { ok: true, cached: false });
}
