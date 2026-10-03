import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
/** A throwaway RSA key pair standing in for Cashfree's public key (tests only). */
export function testKeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return { publicKey, privateKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}
/** Decrypts an x-cf-signature the way Cashfree would (RSA-OAEP, SHA-1). */
export function decryptSignature(signature, privateKey, oaepHash = 'sha1') {
    return privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash }, Buffer.from(signature, 'base64')).toString('utf8');
}
