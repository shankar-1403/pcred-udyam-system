import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateCashfreeSignature } from '../src/cashfree/signature.js';
import { CashfreeConfigError, decodePem, readCashfreeConfig } from '../src/cashfree/config.js';
import { decryptSignature, testKeyPair } from './helpers.js';
describe('x-cf-signature', () => {
    const keys = testKeyPair();
    it('encrypts "<clientId>.<unix seconds>" with RSA-OAEP (SHA-1) and base64-encodes it', () => {
        const now = Date.UTC(2026, 9, 1, 3, 22, 43, 900);
        const sig = generateCashfreeSignature('CF_CLIENT_123', keys.publicKey, now);
        expect(sig).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(Buffer.from(sig, 'base64')).toHaveLength(256); // 2048-bit key
        expect(decryptSignature(sig, keys.privateKey)).toBe(`CF_CLIENT_123.${Math.floor(now / 1000)}`);
    });
    it('uses SHA-1 OAEP, not SHA-256', () => {
        const sig = generateCashfreeSignature('id', keys.publicKey);
        expect(() => decryptSignature(sig, keys.privateKey, 'sha256')).toThrow();
    });
    it('is fresh for every call', () => {
        const now = Date.now();
        expect(generateCashfreeSignature('id', keys.publicKey, now)).not.toBe(generateCashfreeSignature('id', keys.publicKey, now));
    });
});
describe('Cashfree configuration', () => {
    const keys = testKeyPair();
    const base = { CASHFREE_CLIENT_ID: 'id', CASHFREE_CLIENT_SECRET: 'secret' };
    it('requires both the client id and the client secret', () => {
        expect(() => readCashfreeConfig({})).toThrow(CashfreeConfigError);
        expect(() => readCashfreeConfig({ CASHFREE_CLIENT_ID: 'id' })).toThrow(CashfreeConfigError);
        expect(() => readCashfreeConfig({ CASHFREE_CLIENT_SECRET: 'secret' })).toThrow(CashfreeConfigError);
    });
    it('works without a public key (2FA by IP whitelisting)', () => {
        expect(readCashfreeConfig(base)).toMatchObject({ clientId: 'id', clientSecret: 'secret', publicKey: null });
    });
    it('reads the public key as multi-line PEM, one-line PEM with \\n, base64, or a file path', () => {
        const oneLine = keys.publicPem.trim().replace(/\n/g, '\\n');
        const b64 = Buffer.from(keys.publicPem).toString('base64');
        const dir = mkdtempSync(join(tmpdir(), 'cf-key-'));
        const file = join(dir, 'cashfree_public_key.pem');
        writeFileSync(file, keys.publicPem);
        for (const env of [
            { ...base, CASHFREE_PUBLIC_KEY: keys.publicPem },
            { ...base, CASHFREE_PUBLIC_KEY: oneLine },
            { ...base, CASHFREE_PUBLIC_KEY: `"${oneLine}"` },
            { ...base, CASHFREE_PUBLIC_KEY: b64 },
            { ...base, CASHFREE_PUBLIC_KEY_PATH: file },
        ]) {
            const cfg = readCashfreeConfig(env);
            expect(cfg.publicKey?.asymmetricKeyType).toBe('rsa');
        }
        expect(decodePem(oneLine)).toContain('-----BEGIN PUBLIC KEY-----\n');
    });
    it('rejects an unreadable or invalid key with a clear error', () => {
        expect(() => readCashfreeConfig({ ...base, CASHFREE_PUBLIC_KEY: 'not a key' })).toThrow(CashfreeConfigError);
        expect(() => readCashfreeConfig({ ...base, CASHFREE_PUBLIC_KEY_PATH: '/nonexistent/key.pem' })).toThrow(/cannot be read/);
    });
});
