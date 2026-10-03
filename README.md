# PCRED Udyam Scheme Report: Udyam number verification (React + Firebase)

Visitors type their **Udyam Registration Number** instead of uploading the certificate PDF.
A Firebase Cloud Function looks the number up with the **Cashfree Verification Suite (production)**.
The page shows the full Udyam record and builds the scheme eligibility report from it.

```
Browser (React, Firebase Hosting)                Cloud Function udyamVerify (asia-south1)        Cashfree (production)
  POST /api/udyam/verify {"udyam": "..."}  ──►     validate · rate-limit · x-cf-signature   ──►   POST https://api.cashfree.com/verification/udyam
  ◄── { ok, data | error }                        (secrets in Secret Manager)              ◄──   Udyam record
```

The Cashfree client ID, client secret, public key and signature never reach the browser.
The browser only calls its own domain, and Firebase Hosting rewrites `/api/udyam/verify` to the function.

---

## 1. What is in this project

The starting point was the existing Udyam Scheme Report page. It is a single HTML file with no backend, the scheme data embedded in the page, PDF upload and PDF export.
No Cashfree integration existed before this one.

| Path | What it is |
|---|---|
| `firebase.json`, `.firebaserc` | Hosting (serves `dist`, rewrites `/api/udyam/verify` → `udyamVerify` in `asia-south1`, security headers) and Functions config. Put your project ID in `.firebaserc`. |
| `package.json` | The only package file. React, Vite, and Cloud Functions dependencies install into the root `node_modules`. `main` is `functions/index.js`, which Firebase deploys. |
| **functions/** | **Backend (Cloud Functions 2nd gen, Node 22, JavaScript).** `functions/index.js` is the deploy entry. |
| `functions/index.js` | The HTTPS function `udyamVerify`: region, secrets, timeout and `maxInstances`, plus the optional static-IP settings. |
| `functions/src/handler.js` | Endpoint logic: method/origin/content-type/size checks, input validation, per-visitor rate limit, in-flight de-duplication, and the response format. |
| `functions/src/cashfree/config.js` | Reads the credentials and public key. The endpoint is fixed to production. |
| `functions/src/cashfree/signature.js` | Builds `x-cf-signature` fresh on every request. |
| `functions/src/cashfree/udyam-client.js` | Udyam verification service: request body, headers, 15 s timeout, Cashfree status and error mapping, safe logging. |
| `functions/src/udyam/validate.js` | Udyam number validation, **shared with the front end**. |
| `functions/src/udyam/normalize.js` | Cleans Cashfree's response. Only known fields are kept, every value is a string, there are no `null`/`undefined` values, and only http(s) certificate links pass. |
| `functions/src/server/*` | Rate limiter, origin and IP helpers, and structured logs for Cloud Logging. |
| `functions/test/*` | 59 unit tests (Vitest) and Cashfree-style fixtures. |
| `functions/.env.example`, `.secret.local.example` | Optional limits, and secrets for the local emulator. |
| `index.html`, `src/`, `public/`, `vite.config.js` | **Front end (React 19 + Vite, JavaScript)**, laid out like a standard Vite React app. `npm run build` writes `dist/`. |
| `src/components/UdyamVerification.jsx` | Card 1, "Udyam Verification": input, Verify, Reset, loading, validation, success and error messages. |
| `src/components/UdyamDetails.jsx` | Results: Enterprise Overview, Registration Details, Address, Verification, Unit Locations, NIC Codes, Classification History, Udyam Certificate. |
| `src/components/ReportApp.jsx` | Page layout. Feeds the verified record into the report engine. |
| `src/report/engine.js` | The existing report engine (rules, report, PDF), ported. The upload and parsing code was replaced by `applyUdyam()`, and the PDF now downloads in a normal browser. |
| `src/data/states.json`, `extras.json` | State, sector, export and startup scheme data, as before. |
| `src/styles/*` | The existing PCRED design system, plus styles for the new feature. |
| `tests/e2e/run-e2e.mjs` | 19 browser tests run under the production CSP, with screenshots. |
| `scripts/sync-from-artifact.mjs` | Copies the monthly rule-check updates (data and central rules) from the report page into this project. |
| `scripts/emulator-smoke.mjs` | Checks the Hosting → rewrite → function wiring in the emulator. |

---

## 2. Requirements

* A Firebase project on the **Blaze** plan. Cloud Functions require it.
* Node.js 22 and npm.
* Production credentials for the Cashfree Verification Suite, with 2FA set to **Public Key**.

```bash
npm install            # one install for the React app, Cloud Functions, and the Firebase CLI
npx firebase login
npx firebase use --add # choose your project; this updates .firebaserc
```

---

## 3. Credentials and key material (Secret Manager)

The function reads five **Firebase secrets**. They are stored in Google Secret Manager and are never in code or `.env` files:

| Secret | Value |
|---|---|
| `CASHFREE_CLIENT_ID` | Production client ID (Cashfree dashboard → Verification Suite → Developers → API Keys) |
| `CASHFREE_CLIENT_SECRET` | The matching production client secret |
| `CASHFREE_PUBLIC_KEY` | Cashfree's public key (`.pem`) for Public Key 2FA |
| `CASHFREE_PG_CLIENT_ID` | Payment Gateway client ID (Cashfree dashboard → Payment Gateway → Developers → API Keys). Not the Verification Suite key. |
| `CASHFREE_PG_CLIENT_SECRET` | The matching Payment Gateway client secret |

1. In Cashfree, go to Developers → Two-Factor Authentication, choose **Public Key** and generate the key.
   The download is password-protected. Unzip it with the password Cashfree emails to your registered address to get the `.pem`.
   Keep this the same key you used successfully in Postman.
2. Store the secrets:
   ```bash
   npx firebase functions:secrets:set CASHFREE_CLIENT_ID
   npx firebase functions:secrets:set CASHFREE_CLIENT_SECRET
   npx firebase functions:secrets:set CASHFREE_PUBLIC_KEY --data-file ./cashfree_public_key.pem
   npx firebase functions:secrets:set CASHFREE_PG_CLIENT_ID
   npx firebase functions:secrets:set CASHFREE_PG_CLIENT_SECRET
   rm ./cashfree_public_key.pem      # don't leave the key on disk or in git
   ```
3. Optional, non-secret settings: copy `functions/.env.example` to `functions/.env`. It covers rate limits and other allowed origins.

**How the signature is made** (per Cashfree's 2FA signature guide):

1. Take `"<clientId>.<current UNIX time in seconds>"`.
2. Encrypt it with the public key using RSA/ECB/OAEPWithSHA-1AndMGF1Padding.
3. Base64-encode the result and send it as `x-cf-signature`.

A new signature is generated for every request. A signature is valid for about 5 minutes, so an expired one cannot be reused.
Every request also sends `x-client-id`, `x-client-secret` and `Content-Type: application/json`. The body is exactly `{"verification_id": "...", "udyam": "UDYAM-XX-00-0000000"}`.
The `verification_id` is unique per request: `pcred_udyam_<time>_<random>`, at most 50 characters, letters, digits and `_` only.

If you later switch Cashfree 2FA to IP whitelisting, you no longer need the public key. Remove `CASHFREE_PUBLIC_KEY` from `secrets` in `functions/index.js`, and `x-cf-signature` is no longer sent.

---

## 4. IP whitelisting

Cashfree's two 2FA methods are alternatives: **Public Key** (works from any IP) or **IP whitelisting** (static IPs only, up to 25).

* **Your setup (Public Key):** nothing else is needed.
  Cloud Functions use changing outbound IPs, and that is fine because every request is signed.
* **If 2FA is IP whitelisting:** Cloud Functions have **dynamic** outbound IPs, and your Postman IP is not your server's IP.
  Give the function a static outbound IP through a VPC connector and Cloud NAT in `asia-south1`:
  ```bash
  gcloud services enable vpcaccess.googleapis.com compute.googleapis.com
  gcloud compute addresses create udyam-egress-ip --region=asia-south1
  gcloud compute networks vpc-access connectors create udyam-egress --region=asia-south1 --network=default --range=10.8.0.0/28
  gcloud compute routers create udyam-router --network=default --region=asia-south1
  gcloud compute routers nats create udyam-nat --router=udyam-router --region=asia-south1 \
    --nat-all-subnet-ip-ranges --nat-external-ip-pool=udyam-egress-ip
  gcloud compute addresses describe udyam-egress-ip --region=asia-south1 --format='value(address)'
  ```
  Uncomment `vpcConnector` and `vpcConnectorEgressSettings: 'ALL_TRAFFIC'` in `functions/index.js`, deploy, and whitelist the printed IP in Cashfree.
  If Cashfree still rejects a call, the function log shows `reason: ip_not_whitelisted` and `egress_ip: <the IP Cashfree saw>`.

---

## 5. Deploy

```bash
npm run deploy:functions   # deploys the udyamVerify Cloud Function (JavaScript, no compile step)
npm run deploy             # builds dist/, then deploys Hosting + the udyamVerify function
```

The function runs in `asia-south1` (Mumbai, close to Cashfree). If you change the region, change it in both `functions/index.js` and the rewrite in `firebase.json`.
Watch the logs with `npm run logs`.

---

## 6. Test the integration

**Automated (no Cashfree calls):**

```bash
npm test                       # unit tests: validation, signature, config, normalisation, every Cashfree status/error, handler, entry point
npm run build && npm run test:e2e   # 19 browser tests under the production CSP; screenshots in tests/e2e/artifacts/
npm run build && npx firebase emulators:exec --only functions,hosting --project demo-pcred "node scripts/emulator-smoke.mjs"
```

**Locally against Cashfree:**

1. Copy `functions/.secret.local.example` to `functions/.secret.local` and fill in the real values.
2. Run `npm run emulators` and open http://127.0.0.1:5000.
3. For hot reload, run `npm run dev` (port 5173), which proxies to the emulator.

Each verification is a real, billed Cashfree call. Note also that the emulator's outbound IP is your machine's IP.

**In production:** open your Hosting URL and enter a valid Udyam Registration Number, then click **Verify**. The right side shows the business name and number, with the rest of the report blurred. Pay the report fee (₹99, set in `functions/src/payments/price.js`) through Cashfree. After the payment succeeds you should see:

* "Details fetched: <enterprise name>"
* the Udyam details panel with all eight sections
* card 2 ("Details we read") filled in with "from Udyam record"
* the scheme report rebuilt for that business, with **Download PDF** working

The full record is not sent to the browser until Cashfree reports the order as paid.

Try a wrong number to see "Udyam Registration Number not found", and **Reset** to go back to the example.

### API contract

`POST /api/udyam/verify` with `Content-Type: application/json` and body `{"udyam": "UDYAM-MH-26-0012345"}`. The input is trimmed, upper-cased and checked against `UDYAM-XX-00-0000000`.
A success returns `200 {"ok": true, "preview": {...}, "sealed": "...", "price": {"amount": 99, "currency": "INR"}}`. `preview` has only the confirmation fields (name, Udyam number, type, activity, organisation, district, state). `sealed` is the full record encrypted for this server. It cannot be read in the browser.

`POST /api/udyam/checkout` with `{"sealed", "phone"}` creates a Cashfree Payment Gateway order and returns `payment_session_id`.
`POST /api/udyam/unlock` with `{"order_id", "sealed"}` checks that the order is paid and matches this seal, then returns `200 {"ok": true, "data": {...}}`. `data` uses Cashfree's field names: `udyam_number`, `enterprise_name`, `split_address`, `unit_locations`, `nic_codes`, `classification_history`, `udyam_certificate_url`, and so on.

| Situation | HTTP | `error.code` | Message shown |
|---|---|---|---|
| Bad format / empty | 400 | `INVALID_UDYAM` | Format hint |
| `UDYAM_NOT_FOUND` | 404 | `UDYAM_NOT_FOUND` | Udyam Registration Number not found |
| `UDYAM_IS_CANCELLED` | 410 | `UDYAM_IS_CANCELLED` | This Udyam registration has been cancelled |
| Invalid client ID/secret, test-environment secret, bad or expired signature, IP not whitelisted, insufficient balance, missing secrets | 503 | `SERVICE_UNAVAILABLE` | Udyam verification is temporarily unavailable… (the exact reason is only in the server log) |
| Cashfree rate limit or ours (5/min, 30/day per visitor) | 429 | `RATE_LIMITED` | Too many verification requests… |
| Cashfree 5xx / duplicate verification ID (retried once with a new ID) | 502 | `UPSTREAM_ERROR` | Service not responding… |
| Timeout (15 s) | 504 | `TIMEOUT` | The verification took too long… |
| Network failure | 502 | `NETWORK_ERROR` | Could not reach the service… |
| Missing / malformed response | 502 | `BAD_RESPONSE` | Unexpected response… |

Errors after a Cashfree call include `error.reference`, which is the `verification_id`, for support.
Logs are JSON lines in Cloud Logging. They contain the reason, the Cashfree code and HTTP status, the reference ID and a masked Udyam number. They never contain credentials, the signature, or the enterprise's name, address, mobile or email.

---

## 7. What stayed the same

* **Unchanged:**
  * the scheme rules
  * the state, sector, export and startup data
  * the report layout and the PDF report
  * the "Details we read" card, which can still be edited
  * the three questions
  * the PCRED branding and disclaimers
* **Replaced:** the certificate upload and "Let Claude read it". The page now starts from the Udyam number.
* **New:** the PDF now downloads directly in the browser.
* **Fonts:** now self-hosted, so the page makes no requests to third parties.

**Monthly rule check:** the Claude report page is still where scheme data is updated. After each monthly update, save that page's HTML and run:
```bash
npm run sync:artifact -- path/to/udyam-scheme-report.html && npm test && npm run deploy
```

## 8. Security notes and options

* Secrets are in Secret Manager, the endpoint is fixed to production, and nothing sensitive is in the browser bundle.
* Firebase Hosting serves a strict CSP and other security headers.
* Browser calls from other websites are refused. Add trusted sites to `UDYAM_ALLOWED_ORIGINS` if you embed the tool elsewhere.
* Every lookup is billed, which is why the rate limit, `maxInstances: 5` and the in-flight de-duplication are there.
* For stronger bot protection, add **Firebase App Check** (reCAPTCHA Enterprise) and verify its token in `handler.js`. You can also require a signed-in Firebase Auth user if this should be members-only.
