import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/server/rate-limit.js';
import { clientIp, isAllowedOrigin } from '../src/server/request.js';
describe('RateLimiter', () => {
    it('enforces the per-minute and per-day windows per key', () => {
        const rl = new RateLimiter(2, 3);
        const t0 = 1_000_000;
        expect(rl.check('a', t0).allowed).toBe(true);
        expect(rl.check('a', t0 + 1).allowed).toBe(true);
        const third = rl.check('a', t0 + 2);
        expect(third.allowed).toBe(false);
        expect(third.retryAfterSeconds).toBeGreaterThan(0);
        expect(rl.check('b', t0 + 2).allowed).toBe(true);
        expect(rl.check('a', t0 + 61_000).allowed).toBe(false); // minute reset, but 4th today
        expect(rl.check('a', t0 + 86_400_001).allowed).toBe(true);
    });
});
describe('request helpers', () => {
    it('takes the visitor IP from the proxy headers', () => {
        expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
        expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.10' }))).toBe('203.0.113.10');
        expect(clientIp(new Headers())).toBe('unknown');
    });
    it('allows same-origin and listed origins only', () => {
        const h = (o) => new Headers({ host: 'reports.pcred.in', ...o });
        expect(isAllowedOrigin(h({}), '')).toBe(true);
        expect(isAllowedOrigin(h({ origin: 'https://reports.pcred.in' }), '')).toBe(true);
        expect(isAllowedOrigin(h({ origin: 'https://evil.example' }), '')).toBe(false);
        expect(isAllowedOrigin(h({ origin: 'https://www.pcred.in' }), 'https://www.pcred.in/')).toBe(true);
        expect(isAllowedOrigin(h({ origin: 'null' }), '')).toBe(false);
        expect(isAllowedOrigin(new Headers({ host: 'internal:3000', 'x-forwarded-host': 'reports.pcred.in', origin: 'https://reports.pcred.in' }), '')).toBe(true);
    });
});
