import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const OTP_TTL_MS = 5 * 60 * 1000;
const PROOF_TTL_MS = 30 * 60 * 1000;

function mac(secret, payload) {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}

function sign(obj, secret) {
    const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${payload}.${mac(secret, payload)}`;
}

function open(token, secret, now) {
    if (typeof token !== 'string')
        return { ok: false, reason: 'invalid' };
    const dot = token.indexOf('.');
    if (dot <= 0)
        return { ok: false, reason: 'invalid' };
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = mac(secret, payload);
    const got = Buffer.from(sig);
    const want = Buffer.from(expected);
    if (got.length !== want.length || !timingSafeEqual(got, want))
        return { ok: false, reason: 'invalid' };
    let data;
    try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    }
    catch {
        return { ok: false, reason: 'invalid' };
    }
    if (!data || typeof data.exp !== 'number')
        return { ok: false, reason: 'invalid' };
    if (now > data.exp)
        return { ok: false, reason: 'expired' };
    return { ok: true, data };
}

function otpHash(phone, otp, secret) {
    return createHash('sha256').update(`${secret}|${phone}|${otp}`).digest('base64url');
}

/** A 6-digit code and a signed challenge the browser must send back. The code is not inside the challenge. */
export function issueOtp(phone, secret, now = Date.now()) {
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challenge = sign({
        kind: 'otp',
        phone,
        exp: now + OTP_TTL_MS,
        hash: otpHash(phone, otp, secret),
    }, secret);
    return { otp, challenge };
}

export function checkOtp(phone, otp, challenge, secret, now = Date.now()) {
    const opened = open(challenge, secret, now);
    if (!opened.ok)
        return opened;
    const data = opened.data;
    if (data.kind !== 'otp' || data.phone !== phone)
        return { ok: false, reason: 'invalid' };
    const hash = otpHash(phone, String(otp ?? ''), secret);
    const got = Buffer.from(hash);
    const want = Buffer.from(String(data.hash ?? ''));
    if (got.length !== want.length || !timingSafeEqual(got, want))
        return { ok: false, reason: 'mismatch' };
    return { ok: true, proof: sign({ kind: 'proof', phone, exp: now + PROOF_TTL_MS }, secret) };
}

export function readProof(proof, secret, now = Date.now()) {
    const opened = open(proof, secret, now);
    if (!opened.ok || opened.data.kind !== 'proof' || typeof opened.data.phone !== 'string')
        return null;
    return opened.data;
}
