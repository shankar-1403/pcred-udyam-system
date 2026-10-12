import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { handleVerifyRequest } from '../src/handler.js';
import { handleCertificateRequest, handleLeadRequest, handleOtpSendRequest, handleOtpVerifyRequest } from '../src/intake/handler.js';
import { CERTIFICATE_PRICE_INR } from '../src/payments/price.js';
import { LEAD_ACTIVE_MS, leadDocument, leadState } from '../src/leads/store.js';
import { parseCertificateText } from '../src/udyam/parse-certificate.js';

const record = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/udyam-success.normalized.json'), 'utf8'));
const SECRET = 'test-seal-secret';
const NOW = 1_000_000;
const allow = { check: () => ({ allowed: true, retryAfterSeconds: 0 }) };

function request(path, body) {
    return {
        method: 'POST',
        path,
        url: path,
        headers: new Headers({
            'content-type': 'application/json',
            origin: 'https://pcred-udyam-system.web.app',
            'x-forwarded-host': 'pcred-udyam-system.web.app',
        }),
        rawBody: JSON.stringify(body),
    };
}

afterEach(() => {
    delete process.env.OTP_DEV_ECHO;
});

const CERT = `
UDYAM REGISTRATION NUMBER
UDYAM-MH-26-0012345
NAME OF ENTERPRISE
SHREE GANESH ENGINEERING WORKS
TYPE OF ENTERPRISE
MICRO
`;

describe('lead documents', () => {
    it('keeps the full Udyam record and the visitor answers', () => {
        const lead = leadDocument(record, { source: 'udyam_number', phone: '9876543210', women: true });
        expect(lead).toMatchObject({
            status: 'active',
            source: 'udyam_number',
            phone: '9876543210',
            women_hold_51: true,
            udyam_number: record.udyam_number,
            enterprise_name: record.enterprise_name,
            district: 'PUNE',
            state: 'MAHARASHTRA',
        });
        expect(lead.details.split_address.flat).toBe('Shed No. 12');
        expect(lead.details.nic_codes).toHaveLength(3);
    });
    it('stays reusable for 90 days and then expires', () => {
        const created = 1_700_000_000_000;
        expect(leadState({ status: 'active', created_at: created }, created + LEAD_ACTIVE_MS - 1)).toBe('active');
        expect(leadState({ status: 'new', created_at: created }, created + 1_000)).toBe('active');
        expect(leadState({ status: 'active', created_at: created }, created + LEAD_ACTIVE_MS)).toBe('expired');
        expect(leadState({ status: 'inactive', created_at: created }, created + 1)).toBe('inactive');
        expect(leadState({ status: 'active', created_at: { seconds: created / 1000 } }, created + 1_000)).toBe('active');
        expect(leadState({ status: 'active' }, created)).toBe('inactive');
    });
    it('drops a phone that was not a 10-digit mobile number', () => {
        expect(leadDocument(record, { phone: '123' }).phone).toBe('');
        expect(leadDocument(record, {}).women_hold_51).toBeNull();
    });
});

describe('saving a lead', () => {
    it('stores the Cashfree record after a verified mobile code', async () => {
        process.env.OTP_DEV_ECHO = '1';
        const otpDeps = { loadSealSecret: () => SECRET, limiter: allow, now: () => NOW };
        const sent = await handleOtpSendRequest(request('/api/udyam/otp/send', { phone: '9876543210' }), otpDeps);
        const verified = await handleOtpVerifyRequest(request('/api/udyam/otp/verify', {
            phone: '9876543210',
            otp: sent.body.dev_code,
            challenge: sent.body.challenge,
        }), otpDeps);
        const saved = [];
        const res = await handleVerifyRequest(request('/api/udyam/verify', {
            udyam: record.udyam_number,
            proof: verified.body.proof,
            women: false,
        }), {
            loadSealSecret: () => SECRET,
            limiter: allow,
            now: () => NOW,
            loadConfig: () => ({}),
            verify: async () => ({ ok: true, record }),
            saveLead: async (lead) => { saved.push(lead); },
        });
        delete process.env.OTP_DEV_ECHO;
        expect(res.status).toBe(200);
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({
            source: 'udyam_number',
            phone: '9876543210',
            women_hold_51: false,
            udyam_number: record.udyam_number,
        });
        expect(saved[0].details.enterprise_name).toBe(record.enterprise_name);
    });
    it('returns a saved report and does not call Cashfree', async () => {
        let called = false;
        const res = await handleVerifyRequest(request('/api/udyam/verify', { udyam: record.udyam_number }), {
            loadSealSecret: () => SECRET,
            limiter: allow,
            now: () => NOW,
            loadConfig: () => ({}),
            verify: async () => { called = true; return { ok: true, record }; },
            findLead: async () => ({
                status: 'active',
                source: 'udyam_number',
                women_hold_51: true,
                created_at: NOW,
                details: record,
            }),
        });
        expect(called).toBe(false);
        expect(res.status).toBe(200);
        expect(res.body.cached).toBe(true);
        expect(res.body.women).toBe(true);
        expect(res.body.data.enterprise_name).toBe(record.enterprise_name);
        expect(res.body.sealed).toBeUndefined();
    });
    it('fetches again when the lead lookup fails', async () => {
        let called = false;
        const res = await handleVerifyRequest(request('/api/udyam/verify', { udyam: record.udyam_number }), {
            loadSealSecret: () => SECRET,
            limiter: allow,
            loadConfig: () => ({}),
            verify: async () => { called = true; return { ok: true, record }; },
            findLead: async () => { throw new Error('database down'); },
        });
        expect(called).toBe(true);
        expect(res.status).toBe(200);
        expect(res.body.preview.udyam_number).toBe(record.udyam_number);
    });
    it('still returns the preview when the database write fails', async () => {
        const res = await handleVerifyRequest(request('/api/udyam/verify', { udyam: record.udyam_number }), {
            loadSealSecret: () => SECRET,
            limiter: allow,
            loadConfig: () => ({}),
            verify: async () => ({ ok: true, record }),
            saveLead: async () => { throw new Error('database down'); },
        });
        expect(res.status).toBe(200);
        expect(res.body.preview.udyam_number).toBe(record.udyam_number);
    });
    it('stores certificate details as a certificate lead', async () => {
        process.env.OTP_DEV_ECHO = '1';
        const otpDeps = { loadSealSecret: () => SECRET, limiter: allow, now: () => NOW };
        const sent = await handleOtpSendRequest(request('/api/udyam/otp/send', { phone: '9123456780' }), otpDeps);
        const verified = await handleOtpVerifyRequest(request('/api/udyam/otp/verify', {
            phone: '9123456780',
            otp: sent.body.dev_code,
            challenge: sent.body.challenge,
        }), otpDeps);
        const saved = [];
        const res = await handleCertificateRequest(request('/api/udyam/certificate', {
            proof: verified.body.proof,
            women: true,
            record: parseCertificateText(CERT),
        }), { ...otpDeps, saveLead: async (lead) => { saved.push(lead); } });
        delete process.env.OTP_DEV_ECHO;
        expect(res.status).toBe(200);
        expect(saved[0]).toMatchObject({
            source: 'certificate',
            phone: '9123456780',
            women_hold_51: true,
            enterprise_name: 'SHREE GANESH ENGINEERING WORKS',
        });
        expect(res.body.price.amount).toBe(CERTIFICATE_PRICE_INR);
    });
    it('reuses a saved certificate lead instead of sealing a new one', async () => {
        process.env.OTP_DEV_ECHO = '1';
        const otpDeps = { loadSealSecret: () => SECRET, limiter: allow, now: () => NOW };
        const sent = await handleOtpSendRequest(request('/api/udyam/otp/send', { phone: '9123456780' }), otpDeps);
        const verified = await handleOtpVerifyRequest(request('/api/udyam/otp/verify', {
            phone: '9123456780',
            otp: sent.body.dev_code,
            challenge: sent.body.challenge,
        }), otpDeps);
        const saved = [];
        const res = await handleCertificateRequest(request('/api/udyam/certificate', {
            proof: verified.body.proof,
            women: true,
            record: parseCertificateText(CERT),
        }), {
            ...otpDeps,
            saveLead: async (lead) => { saved.push(lead); },
            findLead: async () => ({
                status: 'active',
                source: 'certificate',
                women_hold_51: false,
                created_at: NOW,
                details: record,
            }),
        });
        delete process.env.OTP_DEV_ECHO;
        expect(res.body.cached).toBe(true);
        expect(res.body.source).toBe('certificate');
        expect(res.body.women).toBe(false);
        expect(saved).toHaveLength(0);
    });
});

describe('lead lookup', () => {
    it('says when no active lead is stored', async () => {
        const res = await handleLeadRequest(request('/api/udyam/lead', { udyam: record.udyam_number }), {
            limiter: allow,
            findLead: async () => null,
        });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, cached: false });
    });
    it('returns the stored report for an active lead', async () => {
        const seen = [];
        const res = await handleLeadRequest(request('/api/udyam/lead', { udyam: `  ${record.udyam_number.toLowerCase()}  ` }), {
            limiter: allow,
            now: () => NOW,
            findLead: async (udyam) => {
                seen.push(udyam);
                return {
                    status: 'active',
                    source: 'udyam_number',
                    women_hold_51: true,
                    created_at: NOW,
                    details: record,
                };
            },
        });
        expect(seen).toEqual([record.udyam_number]);
        expect(res.body.cached).toBe(true);
        expect(res.body.data.udyam_number).toBe(record.udyam_number);
    });
});
