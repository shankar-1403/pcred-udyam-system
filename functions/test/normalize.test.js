import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUdyamSuccess, safeHttpUrl } from '../src/udyam/normalize.js';
const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8');
const raw = JSON.parse(fixture('udyam-success.json'));
const expected = JSON.parse(fixture('udyam-success.normalized.json'));
describe('normalizeUdyamSuccess', () => {
    it('turns a Cashfree success body into the record the page shows', () => {
        expect(normalizeUdyamSuccess(raw, 'UDYAM-MH-26-0012345')).toEqual(expected);
    });
    it('turns numbers into strings and null / missing values into empty strings', () => {
        const r = normalizeUdyamSuccess(raw);
        expect(r.reference_id).toBe('3478283');
        expect(r.split_address.block).toBe('');
        expect(r.split_address.village).toBe('');
        expect(JSON.stringify(r)).not.toMatch(/null,|undefined/);
    });
    it('copes with missing sections and drops unknown fields', () => {
        const r = normalizeUdyamSuccess({ status: 'SUCCESS', udyam_number: 'UDYAM-UP-43-1234567', extra_field: 'x', nic_codes: 'oops', split_address: null });
        expect(r.unit_locations).toEqual([]);
        expect(r.nic_codes).toEqual([]);
        expect(r.classification_history).toEqual([]);
        expect(r.split_address.city).toBe('');
        expect(r.udyam_certificate_url).toBeNull();
        expect(r).not.toHaveProperty('extra_field');
    });
    it('returns null for anything that is not a usable SUCCESS response', () => {
        expect(normalizeUdyamSuccess(null)).toBeNull();
        expect(normalizeUdyamSuccess('SUCCESS')).toBeNull();
        expect(normalizeUdyamSuccess({ status: 'UDYAM_NOT_FOUND' })).toBeNull();
        expect(normalizeUdyamSuccess({ status: 'SUCCESS' })).toBeNull();
    });
    it('keeps only http(s) certificate links', () => {
        expect(safeHttpUrl('https://cdn.example.com/cert.pdf')).toBe('https://cdn.example.com/cert.pdf');
        expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
        expect(safeHttpUrl('data:text/html,hi')).toBeNull();
        expect(safeHttpUrl('UDYAM_CERTIFICATE_PDF_URL')).toBeNull();
        expect(safeHttpUrl('')).toBeNull();
        expect(safeHttpUrl(null)).toBeNull();
    });
});
