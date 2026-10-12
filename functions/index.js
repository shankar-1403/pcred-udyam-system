import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { handleVerifyRequest } from './src/handler.js';
import { handleCheckoutRequest, handleUnlockRequest } from './src/payments/handler.js';
import { handleCertificateRequest, handleLeadRequest, handleOtpSendRequest, handleOtpVerifyRequest } from './src/intake/handler.js';
import { readCashfreeConfig } from './src/cashfree/config.js';
import { apiRoute } from './src/server/route.js';
import { logEvent } from './src/server/log.js';
import { deactivateExpiredLeads, realtimeLeadLookup, realtimeLeadStore } from './src/leads/store.js';
// Firebase Hosting rewrites POST /api/udyam/verify to this function (see firebase.json).
// Keep REGION in sync with the rewrite's "region".
const REGION = 'asia-south1';
// Cashfree Verification Suite (production) credentials, stored in Google Secret Manager:
//   firebase functions:secrets:set CASHFREE_CLIENT_ID
//   firebase functions:secrets:set CASHFREE_CLIENT_SECRET
//   firebase functions:secrets:set CASHFREE_PUBLIC_KEY --data-file cashfree_public_key.pem
const CASHFREE_CLIENT_ID = defineSecret('CASHFREE_CLIENT_ID');
const CASHFREE_CLIENT_SECRET = defineSecret('CASHFREE_CLIENT_SECRET');
const CASHFREE_PUBLIC_KEY = defineSecret('CASHFREE_PUBLIC_KEY');
// Payment Gateway keys (Cashfree dashboard → Payment Gateway → Developers → API Keys).
// These are separate from the Verification Suite keys above.
const CASHFREE_PG_CLIENT_ID = defineSecret('CASHFREE_PG_CLIENT_ID');
const CASHFREE_PG_CLIENT_SECRET = defineSecret('CASHFREE_PG_CLIENT_SECRET');
// Fast2SMS Dev API key (https://www.fast2sms.com → Dev API). Used only to text the OTP.
//   firebase functions:secrets:set FAST2SMS_API_KEY
const FAST2SMS_API_KEY = defineSecret('FAST2SMS_API_KEY');
let config = null;
function loadConfig() {
    if (!config) {
        config = readCashfreeConfig({
            CASHFREE_CLIENT_ID: CASHFREE_CLIENT_ID.value(),
            CASHFREE_CLIENT_SECRET: CASHFREE_CLIENT_SECRET.value(),
            CASHFREE_PUBLIC_KEY: CASHFREE_PUBLIC_KEY.value(),
        });
    }
    return config;
}
function toHeaders(raw) {
    const h = new Headers();
    for (const [k, v] of Object.entries(raw)) {
        if (Array.isArray(v))
            v.forEach((x) => h.append(k, x));
        else if (typeof v === 'string')
            h.set(k, v);
    }
    return h;
}
function loadSealSecret() {
    return CASHFREE_CLIENT_SECRET.value();
}
function loadPgConfig() {
    return {
        clientId: CASHFREE_PG_CLIENT_ID.value().trim(),
        clientSecret: CASHFREE_PG_CLIENT_SECRET.value().trim(),
    };
}
function loadSmsConfig() {
    return { apiKey: FAST2SMS_API_KEY.value().trim() };
}
export const udyamVerify = onRequest({
    region: REGION,
    secrets: [CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, CASHFREE_PUBLIC_KEY, CASHFREE_PG_CLIENT_ID, CASHFREE_PG_CLIENT_SECRET, FAST2SMS_API_KEY],
    timeoutSeconds: 30,
    memory: '256MiB',
    // Caps spend if someone hammers the endpoint; raise if you expect heavy traffic.
    maxInstances: 5,
    invoker: 'public',
    // Only needed if Cashfree 2FA is IP whitelisting instead of Public Key: route outbound
    // traffic through a VPC connector + Cloud NAT with a reserved static IP (see README).
    // vpcConnector: 'udyam-egress',
    // vpcConnectorEgressSettings: 'ALL_TRAFFIC',
}, async (req, res) => {
    const incoming = {
        method: req.method,
        path: req.path,
        url: req.url,
        originalUrl: req.originalUrl,
        headers: toHeaders(req.headers),
        rawBody: req.rawBody ? req.rawBody.toString('utf8') : '',
    };
    const deps = {
        loadConfig,
        loadSealSecret,
        loadPgConfig,
        loadSmsConfig,
        saveLead: realtimeLeadStore(),
        findLead: realtimeLeadLookup(),
    };
    const route = apiRoute(incoming);
    const result = route === 'checkout'
        ? await handleCheckoutRequest(incoming, deps)
        : route === 'unlock'
            ? await handleUnlockRequest(incoming, deps)
            : route === 'otp-send'
                ? await handleOtpSendRequest(incoming, deps)
                : route === 'otp-verify'
                    ? await handleOtpVerifyRequest(incoming, deps)
                    : route === 'certificate'
                        ? await handleCertificateRequest(incoming, deps)
                        : route === 'lead'
                            ? await handleLeadRequest(incoming, deps)
                            : await handleVerifyRequest(incoming, deps);
    res.status(result.status).set(result.headers);
    if (result.body === null)
        res.end();
    else
        res.json(result.body);
});

/** Turns off leads that are older than 90 days, so the next visit fetches again. */
export const deactivateLeads = onSchedule({
    schedule: 'every 24 hours',
    timeZone: 'Asia/Kolkata',
    region: REGION,
    timeoutSeconds: 300,
    memory: '256MiB',
}, async () => {
    const count = await deactivateExpiredLeads();
    logEvent('info', 'udyam_lead', { outcome: 'deactivated', count });
});
