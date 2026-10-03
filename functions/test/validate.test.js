import { describe, expect, it } from 'vitest';
import { checkUdyamNumber, maskUdyamNumber, normalizeUdyamNumber } from '../src/udyam/validate.js';
describe('Udyam Registration Number validation', () => {
    it('accepts the standard format', () => {
        expect(checkUdyamNumber('UDYAM-MH-26-0012345')).toEqual({ ok: true, value: 'UDYAM-MH-26-0012345' });
    });
    it('trims, upper-cases and tidies separators', () => {
        expect(normalizeUdyamNumber('  udyam-mh-26-0012345 ')).toBe('UDYAM-MH-26-0012345');
        expect(normalizeUdyamNumber('udyam mh 26 0012345')).toBe('UDYAM-MH-26-0012345');
        expect(normalizeUdyamNumber('UDYAM–MH–26–0012345')).toBe('UDYAM-MH-26-0012345');
        expect(checkUdyamNumber('UDYAMMH260012345')).toEqual({ ok: true, value: 'UDYAM-MH-26-0012345' });
    });
    it('rejects empty, non-string and malformed input with a friendly message', () => {
        expect(checkUdyamNumber('')).toMatchObject({ ok: false, message: 'Enter your Udyam Registration Number.' });
        expect(checkUdyamNumber('   ')).toMatchObject({ ok: false });
        expect(checkUdyamNumber(undefined)).toMatchObject({ ok: false });
        expect(checkUdyamNumber(12345)).toMatchObject({ ok: false });
        expect(checkUdyamNumber('UDYAM-MH-18-024500')).toMatchObject({ ok: false }); // 6-digit serial
        expect(checkUdyamNumber('UDYAM-M1-18-0245001')).toMatchObject({ ok: false });
        expect(checkUdyamNumber('UDYAM-MH-18-0245001; DROP')).toMatchObject({ ok: false });
        expect(checkUdyamNumber('X'.repeat(41))).toMatchObject({ ok: false });
        const bad = checkUdyamNumber('hello');
        expect(bad.ok ? '' : bad.message).toContain('UDYAM-XX-00-0000000');
    });
    it('masks numbers for logs', () => {
        expect(maskUdyamNumber('UDYAM-MH-26-0012345')).toBe('UDYAM-MH-26-****345');
        expect(maskUdyamNumber('garbage')).toBe('invalid');
    });
});
