import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicKey } from 'node:crypto';
/** Cashfree Verification Suite: Verify Udyam (production). */
export const CASHFREE_UDYAM_URL = 'https://api.cashfree.com/verification/udyam';
export class CashfreeConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CashfreeConfigError';
    }
}
/**
 * Accepts the PEM as-is (multi-line), as one line with literal "\n" escapes,
 * or as base64 of the whole .pem file.
 */
export function decodePem(value) {
    let v = value.trim().replace(/^["']|["']$/g, '');
    if (v.includes('\\n'))
        v = v.replace(/\\n/g, '\n');
    if (!v.includes('-----BEGIN')) {
        const decoded = Buffer.from(v, 'base64').toString('utf8');
        if (decoded.includes('-----BEGIN'))
            v = decoded;
    }
    return v.trim() + '\n';
}
function loadPublicKey(env) {
    const inline = env.CASHFREE_PUBLIC_KEY?.trim();
    const path = env.CASHFREE_PUBLIC_KEY_PATH?.trim();
    let pem;
    if (inline) {
        pem = decodePem(inline);
    }
    else if (path) {
        try {
            pem = readFileSync(resolve(process.cwd(), path), 'utf8');
        }
        catch {
            throw new CashfreeConfigError('CASHFREE_PUBLIC_KEY_PATH points to a file that cannot be read');
        }
    }
    else {
        return null;
    }
    try {
        return createPublicKey({ key: pem, format: 'pem' });
    }
    catch {
        throw new CashfreeConfigError('The Cashfree public key is not a valid PEM public key');
    }
}
export function readCashfreeConfig(env) {
    const clientId = env.CASHFREE_CLIENT_ID?.trim() ?? '';
    const clientSecret = env.CASHFREE_CLIENT_SECRET?.trim() ?? '';
    if (!clientId || !clientSecret) {
        throw new CashfreeConfigError('CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET must both be set');
    }
    return { clientId, clientSecret, publicKey: loadPublicKey(env) };
}
let cached = null;
/** Reads and caches the configuration from process.env (throws CashfreeConfigError if incomplete). */
export function getCashfreeConfig() {
    if (!cached)
        cached = readCashfreeConfig(process.env);
    return cached;
}
