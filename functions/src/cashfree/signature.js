import { constants, publicEncrypt } from 'node:crypto';
/**
 * x-cf-signature for Cashfree's Public Key two-factor authentication.
 *
 * Per Cashfree's 2FA signature guide: take "<clientId>.<current UNIX time in seconds>",
 * encrypt it with the Cashfree public key using RSA/ECB/OAEPWithSHA-1AndMGF1Padding,
 * and base64-encode the result. A signature is valid for about 5 minutes, so a fresh one
 * is generated for every request.
 */
export function generateCashfreeSignature(clientId, publicKey, nowMs = Date.now()) {
    const payload = `${clientId}.${Math.floor(nowMs / 1000)}`;
    return publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(payload, 'utf8')).toString('base64');
}
