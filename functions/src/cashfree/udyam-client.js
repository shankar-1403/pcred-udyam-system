import { randomBytes } from 'node:crypto';
import { CASHFREE_UDYAM_URL, CashfreeConfigError, getCashfreeConfig } from './config.js';
import { generateCashfreeSignature } from './signature.js';
import { normalizeUdyamSuccess } from '../udyam/normalize.js';
import { maskUdyamNumber } from '../udyam/validate.js';
import { logEvent } from '../server/log.js';
export const CASHFREE_TIMEOUT_MS = 15_000;
/** What the page is told. Technical detail stays in the server log. */
export const USER_MESSAGES = {
    UDYAM_NOT_FOUND: 'Udyam Registration Number not found',
    UDYAM_IS_CANCELLED: 'This Udyam registration has been cancelled',
    INVALID_UDYAM: 'This Udyam Registration Number is not valid. Check it and try again.',
    SERVICE_UNAVAILABLE: 'Udyam verification is temporarily unavailable. Please try again later.',
    RATE_LIMITED: 'Too many verification requests right now. Please wait a minute and try again.',
    UPSTREAM_ERROR: 'The Udyam verification service is not responding right now. Please try again in a few minutes.',
    TIMEOUT: 'The verification took too long. Please try again.',
    NETWORK_ERROR: 'We could not reach the verification service. Please try again.',
    BAD_RESPONSE: 'We received an unexpected response from the verification service. Please try again later.',
};
/** Unique per request: at most 50 characters of letters, digits and underscores. */
export function newVerificationId(now = Date.now()) {
    return `pcred_udyam_${now.toString(36)}_${randomBytes(8).toString('hex')}`;
}
const str = (v) => (typeof v === 'string' ? v : '');
const scrub = (s) => s.replace(/UDYAM-[A-Z]{2}-\d{2}-\d{7}/gi, (m) => maskUdyamNumber(m.toUpperCase())).slice(0, 200);
/** Maps a non-success Cashfree response to what we log and what the page sees. */
export function classifyCashfreeError(httpStatus, body) {
    const b = (typeof body === 'object' && body !== null ? body : {});
    const code = str(b.code).toLowerCase();
    const message = str(b.message).toLowerCase();
    if (httpStatus === 409 || code === 'verification_id_already_exists') {
        return { httpStatus: 502, code: 'UPSTREAM_ERROR', reason: 'duplicate_verification_id', level: 'warn', retryWithNewId: true };
    }
    if (httpStatus === 401) {
        return {
            httpStatus: 503, code: 'SERVICE_UNAVAILABLE', reason: 'invalid_client_credentials', level: 'error',
            hint: 'Check CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET are the production pair for Verification Suite',
        };
    }
    if (httpStatus === 403) {
        if (code === 'ip_validation_failed' || message.includes('whitelist')) {
            const ip = /(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7})/i.exec(str(b.message));
            return {
                httpStatus: 503, code: 'SERVICE_UNAVAILABLE', reason: 'ip_not_whitelisted', level: 'error',
                egressIp: ip ? ip[0] : undefined,
                hint: 'Whitelist this server egress IP in Cashfree (Developers > Two-Factor Authentication) or switch 2FA to Public Key',
            };
        }
        if (message.includes('signature')) {
            return {
                httpStatus: 503, code: 'SERVICE_UNAVAILABLE', reason: 'signature_rejected', level: 'error',
                hint: 'Check CASHFREE_PUBLIC_KEY matches the key in the Cashfree dashboard, 2FA is set to Public Key, and the server clock is correct',
            };
        }
        return { httpStatus: 503, code: 'SERVICE_UNAVAILABLE', reason: 'forbidden', level: 'error' };
    }
    if (httpStatus === 400) {
        if (code.startsWith('x-client') || message.includes('client secret') || message.includes('client id') || message.includes('clientid')) {
            return {
                httpStatus: 503, code: 'SERVICE_UNAVAILABLE', reason: 'client_credentials_rejected', level: 'error',
                hint: 'Use production Verification Suite credentials (a test-environment secret is rejected)',
            };
        }
        if (code.startsWith('verification_id')) {
            return { httpStatus: 502, code: 'UPSTREAM_ERROR', reason: 'verification_id_rejected', level: 'error' };
        }
        if (code.includes('udyam') || message.includes('udyam')) {
            return { httpStatus: 400, code: 'INVALID_UDYAM', reason: 'udyam_rejected', level: 'warn' };
        }
        return { httpStatus: 502, code: 'UPSTREAM_ERROR', reason: 'bad_request', level: 'error' };
    }
    if (httpStatus === 422) {
        if (code === 'insufficient_balance' || message.includes('balance')) {
            return {
                httpStatus: 503, code: 'SERVICE_UNAVAILABLE', reason: 'insufficient_balance', level: 'error',
                hint: 'Top up the Cashfree Verification Suite balance',
            };
        }
        if (code.includes('udyam') || message.includes('udyam')) {
            return { httpStatus: 400, code: 'INVALID_UDYAM', reason: 'udyam_rejected', level: 'warn' };
        }
        return { httpStatus: 502, code: 'UPSTREAM_ERROR', reason: 'unprocessable', level: 'error' };
    }
    if (httpStatus === 429) {
        return { httpStatus: 429, code: 'RATE_LIMITED', reason: code || 'cashfree_rate_limited', level: 'warn' };
    }
    if (httpStatus >= 500) {
        return { httpStatus: 502, code: 'UPSTREAM_ERROR', reason: `cashfree_${httpStatus}`, level: 'warn' };
    }
    return { httpStatus: 502, code: 'UPSTREAM_ERROR', reason: `unexpected_http_${httpStatus}`, level: 'error' };
}
const MAX_ATTEMPTS = 2; // a second attempt only after a duplicate verification_id
/**
 * Verifies a (validated, normalised) Udyam Registration Number with Cashfree's production API.
 * Never throws: every outcome is returned as a VerifyResult.
 */
export async function verifyUdyam(udyam, deps = {}) {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const now = deps.now ?? Date.now;
    const makeId = deps.newVerificationId ?? (() => newVerificationId(now()));
    const timeoutMs = deps.timeoutMs ?? CASHFREE_TIMEOUT_MS;
    const masked = maskUdyamNumber(udyam);
    const started = now();
    const fail = (code, httpStatus, reference) => ({
        ok: false, httpStatus, code, message: USER_MESSAGES[code] ?? USER_MESSAGES.UPSTREAM_ERROR, reference,
    });
    let config;
    try {
        config = deps.config ?? getCashfreeConfig();
    }
    catch (e) {
        logEvent('error', 'udyam_verify', {
            outcome: 'error', reason: 'config_missing', udyam: masked,
            detail: e instanceof CashfreeConfigError ? e.message : 'Cashfree configuration could not be loaded',
        });
        return fail('SERVICE_UNAVAILABLE', 503);
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const verificationId = makeId();
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-client-id': config.clientId,
            'x-client-secret': config.clientSecret,
        };
        if (config.publicKey) {
            try {
                headers['x-cf-signature'] = generateCashfreeSignature(config.clientId, config.publicKey, now());
            }
            catch {
                logEvent('error', 'udyam_verify', { outcome: 'error', reason: 'signature_generation_failed', udyam: masked, verification_id: verificationId });
                return fail('SERVICE_UNAVAILABLE', 503);
            }
        }
        let res;
        let raw;
        try {
            res = await fetchImpl(CASHFREE_UDYAM_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify({ verification_id: verificationId, udyam }),
                signal: AbortSignal.timeout(timeoutMs),
                cache: 'no-store',
            });
            raw = await res.text();
        }
        catch (e) {
            const name = e instanceof Error ? e.name : '';
            const timedOut = name === 'TimeoutError' || name === 'AbortError';
            logEvent('warn', 'udyam_verify', {
                outcome: 'error', reason: timedOut ? 'timeout' : 'network_error', udyam: masked,
                verification_id: verificationId, duration_ms: now() - started,
            });
            return fail(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', timedOut ? 504 : 502, verificationId);
        }
        let body = null;
        try {
            body = raw ? JSON.parse(raw) : null;
        }
        catch {
            body = null;
        }
        const b = (typeof body === 'object' && body !== null ? body : {});
        const status = str(b.status).toUpperCase();
        const referenceId = typeof b.reference_id === 'number' || typeof b.reference_id === 'string' ? String(b.reference_id) : undefined;
        const base = {
            udyam: masked, verification_id: verificationId, reference_id: referenceId,
            cf_http: res.status, duration_ms: now() - started, attempt,
        };
        if (status === 'UDYAM_NOT_FOUND' || status === 'UDYAM_IS_CANCELLED') {
            logEvent('info', 'udyam_verify', { ...base, outcome: status.toLowerCase() });
            return status === 'UDYAM_NOT_FOUND'
                ? fail('UDYAM_NOT_FOUND', 404, verificationId)
                : fail('UDYAM_IS_CANCELLED', 410, verificationId);
        }
        if (res.ok) {
            if (status === 'SUCCESS') {
                const record = normalizeUdyamSuccess(body, udyam);
                if (record) {
                    logEvent('info', 'udyam_verify', { ...base, outcome: 'success' });
                    return { ok: true, record: { ...record, verification_id: record.verification_id || verificationId } };
                }
            }
            logEvent('error', 'udyam_verify', {
                ...base, outcome: 'error', reason: body ? 'unexpected_status' : 'malformed_body', cf_status: status || null,
            });
            return fail('BAD_RESPONSE', 502, verificationId);
        }
        const f = classifyCashfreeError(res.status, body);
        logEvent(f.level, 'udyam_verify', {
            ...base, outcome: 'error', reason: f.reason, cf_code: str(b.code) || null, cf_type: str(b.type) || null,
            cf_message: str(b.message) ? scrub(str(b.message)) : null, egress_ip: f.egressIp, hint: f.hint,
        });
        if (f.retryWithNewId && attempt < MAX_ATTEMPTS)
            continue;
        return fail(f.code, f.httpStatus, verificationId);
    }
    return fail('UPSTREAM_ERROR', 502);
}
