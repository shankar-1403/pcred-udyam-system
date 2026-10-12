#!/usr/bin/env node
// End-to-end checks of the built React app in Chromium.
//
//   npm run build && npm run test:e2e
//
// Serves dist/ with `vite preview` on a spare port (or uses E2E_BASE_URL), applies the
// production security headers from firebase.json to every page, then exercises the Udyam
// Verification flow. The browser's calls to /api/udyam/verify are answered by fixtures, so
// these tests never contact Cashfree. Screenshots go to tests/e2e/artifacts/.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { jsPDF } from 'jspdf';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(repoRoot, 'tests/e2e/artifacts');
mkdirSync(out, { recursive: true });
const RECORD = JSON.parse(readFileSync(join(repoRoot, 'functions/test/fixtures/udyam-success.normalized.json'), 'utf8'));
const FIREBASE = JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8'));
const PROD_HEADERS = Object.fromEntries(FIREBASE.hosting.headers.find((h) => h.source === '**').headers.map((h) => [h.key.toLowerCase(), h.value]));
const URN = RECORD.udyam_number;

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([name, true]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push([name, false]);
    console.log(`  ✗ ${name}\n    ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function freePort() {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function startServer() {
  if (process.env.E2E_BASE_URL) return { base: process.env.E2E_BASE_URL, stop: () => {} };
  const port = await freePort();
  const child = spawn(process.execPath, [join(repoRoot, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base + '/');
      if (r.ok) return { base, stop: () => child.kill('SIGTERM'), log: () => log };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw new Error('vite preview did not come up:\n' + log);
}

const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const success = (record = RECORD) => json(200, { ok: true, data: record });
function previewOf(record) {
  const address = record.split_address || {};
  return {
    enterprise_name: record.enterprise_name,
    udyam_number: record.udyam_number,
    enterprise_type: record.enterprise_type,
    major_activity: record.major_activity,
    organization_type: record.organization_type,
    district: address.district || '',
    state: address.state || '',
  };
}
const locked = (record = RECORD) => json(200, {
  ok: true,
  preview: previewOf(record),
  sealed: 'sealed-test-token',
  price: { amount: 99, currency: 'INR' },
});
const failure = (status, code, message, reference) => json(status, { ok: false, error: { code, message, ...(reference ? { reference } : {}) } });

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  const BASE = server.base;
  console.log(`E2E against ${BASE}`);

  async function openPage({ viewport = { width: 1360, height: 900 }, colorScheme = 'light', handler } = {}) {
    const context = await browser.newContext({ viewport, colorScheme, acceptDownloads: true });
    // Serve every page with the production headers (CSP etc.) that Firebase Hosting adds.
    await context.route('**/*', async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), ...PROD_HEADERS } });
    });
    await context.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const calls = [];
    let pendingRecord = RECORD;
    await page.route('**/api/udyam/verify', async (route) => {
      const req = route.request();
      calls.push({ method: req.method(), body: req.postDataJSON(), headers: req.headers() });
      if (handler) return handler(route, calls.length, (record) => { pendingRecord = record; });
      pendingRecord = RECORD;
      return route.fulfill(locked());
    });
    await page.route('**/api/udyam/checkout', (route) => route.fulfill(json(200, {
      ok: true, order_id: 'pcred_pay_0123456789abcdef', payment_session_id: 'session_test',
    })));
    await page.route('**/api/udyam/unlock', (route) => route.fulfill(success(pendingRecord)));
    await page.route('**/api/udyam/otp/send', (route) => route.fulfill(json(200, {
      ok: true, challenge: 'challenge-test', dev_code: '123456',
    })));
    await page.route('**/api/udyam/otp/verify', (route) => route.fulfill(json(200, { ok: true, proof: 'proof-test' })));
    await page.route('**/api/udyam/certificate', (route) => route.fulfill(locked()));
    await page.route('**/api/udyam/lead', (route) => route.fulfill(json(200, { ok: true, cached: false })));
    await page.route('https://sdk.cashfree.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.Cashfree=function(){return{checkout:function(){return Promise.resolve({paymentDetails:{paymentMessage:"Success"}});}};};',
    }));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#report .cover', { timeout: 15000 });
    return { page, context, errors, calls };
  }
  const urnInput = '#udyam-number';
  const verifyBtn = '#udyam-fetch';
  async function chooseNumber(page) {
    await page.click('#method-number');
    await page.waitForSelector(urnInput);
  }
  async function passOtp(page) {
    await page.fill('#otp-phone', '9876543210');
    await page.click('#otp-send');
    await page.waitForSelector('#otp-code');
    await page.fill('#otp-code', '123456');
    await page.click('#otp-confirm');
    await page.waitForSelector('#women-less');
  }
  async function submitNumber(page, urn = URN) {
    await chooseNumber(page);
    await page.fill(urnInput, urn);
    await page.click('#udyam-continue');
    await passOtp(page);
    await page.click('#women-less');
    await page.click(verifyBtn);
  }
  async function completePayment(page) {
    await page.waitForSelector('#udyam-preview');
    await page.fill('#pay-phone', '9876543210');
    await page.click('#pay-preview');
    await page.waitForSelector('#udyam-details');
  }

  await test('page loads empty until a Udyam number is verified', async () => {
    const { page, context, errors } = await openPage();
    assert(await page.isVisible('#card-udyam'), 'verification card missing');
    assert((await page.textContent('#card-udyam h2')).includes('Udyam Verification'), 'card title');
    assert(await page.isVisible('#method-number'), 'number option');
    assert(await page.isVisible('#method-pdf'), 'certificate option');
    assert(!(await page.$('#certificate-file')), 'PDF upload stays behind its option');
    assert(!(await page.$('#file')), 'old upload id stays unused');
    await chooseNumber(page);
    assert((await page.getAttribute(urnInput, 'id')) === 'udyam-number', 'input');
    assert((await page.textContent('label[for="udyam-number"]')).trim() === 'Udyam Registration Number', 'label text');
    const report = await page.textContent('#report');
    assert(report.includes('No business yet'), 'empty report');
    assert(!report.includes('Anand'), 'sample business should be hidden');
    assert((await page.inputValue('#f-name')) === '', 'details name should be empty');
    assert(!(await page.$('#file')), 'PDF upload input should be gone');
    assert((await page.textContent('.verified')).includes('Rules checked'), 'badge');
    await page.screenshot({ path: join(out, '01-initial.png'), fullPage: false });
    assert(errors.length === 0, errors.join('\n'));
    // The production CSP is active: an injected inline script must be blocked.
    const inlineRan = await page.evaluate(() => {
      const el = document.createElement('script');
      el.textContent = 'window.__inlineRan = true';
      document.head.appendChild(el);
      return window.__inlineRan === true;
    });
    assert(!inlineRan, 'CSP is not applied');
    await context.close();
  });

  await test('validation: empty and badly formatted numbers never reach the API', async () => {
    const { page, context, calls } = await openPage();
    await chooseNumber(page);
    await page.click('#udyam-continue');
    await page.waitForSelector('#udyam-error');
    assert((await page.textContent('#udyam-error')).includes('Enter your Udyam Registration Number'), 'empty message');
    assert((await page.getAttribute(urnInput, 'aria-invalid')) === 'true', 'aria-invalid');
    await page.fill(urnInput, 'UDYAM-MH-18-024500');
    await page.click('#udyam-continue');
    assert((await page.textContent('#udyam-error')).includes('UDYAM-XX-00-0000000'), 'format message');
    await page.fill(urnInput, 'hello');
    await page.press(urnInput, 'Enter');
    assert(calls.length === 0, `expected no API calls, got ${calls.length}`);
    await page.screenshot({ path: join(out, '02-validation.png') });
    await context.close();
  });

  await test('input is trimmed, upper-cased and tidied before it is sent', async () => {
    const { page, context, calls } = await openPage();
    await chooseNumber(page);
    await page.fill(urnInput, '   udyam mh 26 0012345  ');
    await page.click('#udyam-continue');
    assert((await page.textContent('#udyam-chosen')).includes('UDYAM-MH-26-0012345'), 'tidied number');
    await passOtp(page);
    await page.click('#women-less');
    await page.click(verifyBtn);
    await page.waitForSelector('#udyam-preview');
    assert(calls.length === 1, 'one call');
    assert(calls[0].method === 'POST', 'POST');
    assert(JSON.stringify(calls[0].body) === JSON.stringify({ udyam: 'UDYAM-MH-26-0012345', proof: 'proof-test', women: false }), 'body ' + JSON.stringify(calls[0].body));
    await context.close();
  });

  await test('loading state and duplicate-submission guard', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { page, context, calls } = await openPage({ handler: async (route) => { await gate; return route.fulfill(locked()); } });
    await chooseNumber(page);
    await page.fill(urnInput, URN);
    await page.click('#udyam-continue');
    await passOtp(page);
    await page.click('#women-less');
    await page.click(verifyBtn);
    await page.waitForSelector('.uv__msg--info');
    assert((await page.textContent(verifyBtn)).includes('Verifying'), 'button text');
    assert(await page.isDisabled(verifyBtn), 'button disabled');
    await page.evaluate(() => { const f = document.querySelector('#uv-women-form'); f.requestSubmit(); f.requestSubmit(); });
    await page.screenshot({ path: join(out, '03-loading.png') });
    release();
    await page.waitForSelector('#udyam-preview');
    assert(calls.length === 1, `expected 1 call, got ${calls.length}`);
    await context.close();
  });

  await test('success: every section of the record is shown and the report uses it', async () => {
    const { page, context, errors } = await openPage();
    await submitNumber(page);
    await page.waitForSelector('#udyam-preview');
    assert((await page.textContent('#udyam-preview')).includes('SHREE GANESH ENGINEERING WORKS'), 'preview shows the fetched name');
    assert((await page.textContent('#udyam-preview')).includes(URN), 'preview shows the Udyam number');
    assert(await page.isVisible('.ud-lock__blur'), 'blurred half of the preview');
    const beforePay = await page.textContent('body');
    assert(!beforePay.includes('Shed No. 12'), 'address is hidden until payment');
    assert(!beforePay.includes('ga******@gmail.com'), 'email is hidden until payment');
    await page.screenshot({ path: join(out, '04-locked-preview.png') });
    await completePayment(page);
    const msg = await page.textContent('.uv__msg--ok');
    assert(msg.includes('Details fetched: SHREE GANESH ENGINEERING WORKS'), 'success message: ' + msg);
    const details = await page.textContent('#udyam-details');
    for (const s of ['Enterprise Overview', 'Registration Details', 'Address', 'Verification', 'Unit Locations', 'NIC Codes', 'Classification History', 'Udyam Certificate',
      'UDYAM-MH-26-0012345', 'Proprietary', 'Manufacturing', 'OBC', 'Micro', '14 Mar 2017', '1 Apr 2017', '10 Feb 2021', '2025-26', '2 Jun 2025',
      'Shed No. 12', 'Bhosari MIDC Road', 'PUNE', 'MAHARASHTRA', '411026', '98*****210', 'ga******@gmail.com',
      'pcred_udyam_test_0001', '3478283', 'SUCCESS', 'MUMBAI']) {
      assert(details.includes(s), 'missing in details: ' + s);
    }
    assert(!/\bnull\b|\bundefined\b|NaN/.test(details), 'literal null/undefined shown');
    const addrLabels = await page.$$eval('#udyam-details section[aria-label="Address"] dt', (d) => d.map((x) => x.textContent));
    assert(!addrLabels.includes('Village') && !addrLabels.includes('Block'), 'empty address fields should be hidden: ' + addrLabels);
    const count = (label) => page.$$eval(`#udyam-details section[aria-label="${label}"] tbody tr`, (r) => r.length);
    assert((await count('Unit Locations')) === 2, 'unit rows');
    assert((await count('NIC Codes')) === 3, 'nic rows');
    assert((await count('Classification History')) === 3, 'history rows');
    const nicHead = await page.$$eval('#udyam-details section[aria-label="NIC Codes"] th', (t) => t.map((x) => x.textContent));
    assert(nicHead.join('|') === 'S. No.|NIC 2-Digit Code|NIC 2-Digit Description|NIC 4-Digit Code|NIC 4-Digit Description|NIC 5-Digit Code|NIC 5-Digit Description|Activity|Date', 'nic headers ' + nicHead);
    const cert = await page.$('#udyam-certificate');
    assert(cert, 'certificate button');
    assert((await cert.getAttribute('href')) === 'https://example.com/udyam-certificate.pdf', 'certificate href');
    assert((await cert.getAttribute('target')) === '_blank' && (await cert.getAttribute('rel')).includes('noopener'), 'certificate opens safely');
    // report and details card now use the verified record
    assert((await page.textContent('#report .rname')).trim() === 'Shree Ganesh Engineering Works', 'report name');
    assert(!(await page.textContent('#report')).includes('No business yet'), 'empty state should be gone');
    assert((await page.inputValue('#f-name')) === 'Shree Ganesh Engineering Works', 'details name');
    assert((await page.inputValue('#f-size')) === 'micro', 'size');
    assert((await page.inputValue('#f-activity')) === 'manufacturing', 'activity');
    assert((await page.inputValue('#f-social')) === 'obc', 'social');
    assert((await page.inputValue('#f-state')) === 'Maharashtra', 'state');
    assert((await page.inputValue('#f-district')) === 'Pune', 'district');
    assert((await page.inputValue('#f-orgType')) === 'proprietorship', 'org type');
    assert((await page.inputValue('#f-commenced')) === '01/04/2017', 'commenced');
    assert((await page.inputValue('#f-nic')) === '25920, 28221, 33121', 'nic');
    assert((await page.textContent('#s-name')).includes('from Udyam record'), 'source label');
    const tally = await page.$$eval('#report .tally b', (b) => b.map((x) => Number(x.textContent)));
    assert(tally.length === 3 && tally[0] + tally[1] > 0, 'report tally ' + tally);
    await page.screenshot({ path: join(out, '04-success-top.png') });
    await page.locator('#udyam-details').screenshot({ path: join(out, '05-udyam-details.png') });
    await page.screenshot({ path: join(out, '06-success-full.png'), fullPage: true });
    assert(errors.length === 0, errors.join('\n'));
    const csp = await page.evaluate(() => window.__csp);
    assert(csp.length === 0, 'CSP violations: ' + csp.join(', '));
    await context.close();
  });

  await test('PDF report downloads from the website', async () => {
    const { page, context } = await openPage();
    await submitNumber(page);
    await completePayment(page);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#dl')]);
    const file = join(out, download.suggestedFilename());
    await download.saveAs(file);
    const head = readFileSync(file).subarray(0, 5).toString('latin1');
    assert(head === '%PDF-', 'not a PDF: ' + head);
    assert(download.suggestedFilename() === 'PCRED-Scheme-Report-UDYAM-MH-26-0012345.pdf', download.suggestedFilename());
    const csp = await page.evaluate(() => window.__csp);
    assert(csp.length === 0, 'CSP violations while building the PDF: ' + csp.join(', '));
    await context.close();
  });

  await test('existing report features still work after verification (edit details, answer questions)', async () => {
    const { page, context, errors } = await openPage();
    await submitNumber(page);
    await completePayment(page);
    assert((await page.textContent('#state-sec h3')).includes('Maharashtra'), 'state section');
    await page.selectOption('#f-state', 'Gujarat');
    await page.waitForFunction(() => document.querySelector('#state-sec h3')?.textContent.includes('Gujarat'));
    assert((await page.textContent('#s-state')).includes('edited by you'), 'edited label');
    await page.click('#w-yes');
    assert((await page.getAttribute('#w-yes', 'aria-pressed')) === 'true', 'women answer');
    await page.click('#goals .chip[data-v="exports"]');
    await page.waitForFunction(() => document.querySelector('#report .tally__note')?.textContent.includes('export'));
    assert(errors.length === 0, errors.join('\n'));
    await context.close();
  });

  await test('reset clears the form, the details and the report', async () => {
    const { page, context } = await openPage();
    await submitNumber(page);
    await page.waitForSelector('#udyam-preview');
    await page.click('#udyam-reset');
    assert(!(await page.$(urnInput)), 'number field hidden');
    assert(await page.isVisible('#method-number'), 'choice shown again');
    assert(!(await page.$('#udyam-preview')), 'preview removed');
    assert(!(await page.$('#udyam-details')), 'details removed');
    assert(!(await page.$('.uv__msg')), 'message cleared');
    assert((await page.textContent('#report')).includes('No business yet'), 'report cleared');
    assert((await page.inputValue('#f-name')) === '', 'details name cleared');
    await context.close();
  });

  const errorCases = [
    ['not found', failure(404, 'UDYAM_NOT_FOUND', 'Udyam Registration Number not found', 'pcred_udyam_x'), 'Udyam Registration Number not found', false],
    ['cancelled', failure(410, 'UDYAM_IS_CANCELLED', 'This Udyam registration has been cancelled', 'pcred_udyam_x'), 'This Udyam registration has been cancelled', false],
    ['service unavailable', failure(503, 'SERVICE_UNAVAILABLE', 'Udyam verification is temporarily unavailable. Please try again later.', 'pcred_udyam_ref123'), 'temporarily unavailable', true],
    ['rate limited', failure(429, 'RATE_LIMITED', 'Too many verification requests right now. Please wait a minute and try again.'), 'Too many verification requests', false],
    ['timeout', failure(504, 'TIMEOUT', 'The verification took too long. Please try again.', 'pcred_udyam_ref9'), 'took too long', true],
    ['server error without JSON', { status: 500, contentType: 'text/html', body: '<html>oops</html>' }, 'Something went wrong while verifying', false],
    ['success without data', json(200, { ok: true }), 'Something went wrong while verifying', false],
  ];
  for (const [name, response, expected, showsRef] of errorCases) {
    await test(`error state: ${name}`, async () => {
      const { page, context } = await openPage({ handler: (route) => route.fulfill(response) });
      await submitNumber(page);
      await page.waitForSelector('.uv__msg--err');
      const t = await page.textContent('.uv__msg--err');
      assert(t.includes(expected), `expected "${expected}", got "${t}"`);
      assert(!!(await page.$('.uv__ref')) === showsRef, 'reference visibility');
      assert(!(await page.$('#udyam-details')), 'no details on error');
      assert(!(await page.$('#udyam-preview')), 'no preview on error');
      assert(!(await page.isDisabled(verifyBtn)), 'button re-enabled');
      if (name === 'not found') await page.screenshot({ path: join(out, '07-error-not-found.png') });
      await context.close();
    });
  }

  await test('error state: network failure', async () => {
    const { page, context } = await openPage({ handler: (route) => route.abort('internetdisconnected') });
    await submitNumber(page);
    await page.waitForSelector('.uv__msg--err');
    assert((await page.textContent('.uv__msg--err')).includes('could not reach the server'), 'network message');
    await context.close();
  });

  await test('missing certificate link shows the portal fallback', async () => {
    const { page, context } = await openPage({ handler: (route, _n, note) => {
      const record = { ...RECORD, udyam_certificate_url: null, unit_locations: [], classification_history: [] };
      note(record);
      return route.fulfill(locked(record));
    } });
    await submitNumber(page);
    await completePayment(page);
    assert(!(await page.$('#udyam-certificate')), 'no certificate button');
    const t = await page.textContent('#udyam-details section[aria-label="Udyam Certificate"]');
    assert(t.includes('Udyam Registration portal'), 'fallback text');
    assert((await page.textContent('#udyam-details')).includes('No unit locations were returned.'), 'empty units note');
    await context.close();
  });

  await test('mobile layout: no horizontal page scroll, tables scroll inside their cards', async () => {
    const { page, context } = await openPage({ viewport: { width: 390, height: 844 } });
    await submitNumber(page);
    await completePayment(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    await page.screenshot({ path: join(out, '08-mobile.png'), fullPage: true });
    await context.close();
  });

  await test('dark mode renders', async () => {
    const { page, context } = await openPage({ colorScheme: 'dark' });
    await submitNumber(page);
    await completePayment(page);
    await page.screenshot({ path: join(out, '09-dark.png') });
    await context.close();
  });

  await test('certificate PDF is read on the device, then follows OTP, ownership and payment', async () => {
    const pdfPath = join(out, 'certificate.pdf');
    const doc = new jsPDF();
    doc.setFontSize(16);
    const lines = [
      'UDYAM REGISTRATION CERTIFICATE',
      'UDYAM REGISTRATION NUMBER',
      'UDYAM-MH-26-0012345',
      'NAME OF ENTERPRISE',
      'SHREE GANESH ENGINEERING WORKS',
      'TYPE OF ENTERPRISE',
      'MICRO',
      'MAJOR ACTIVITY',
      'MANUFACTURING',
      'OFFICIAL ADDRESS OF ENTERPRISE',
      'District PUNE',
      'State MAHARASHTRA',
    ];
    lines.forEach((line, i) => doc.text(line, 14, 20 + i * 12));
    writeFileSync(pdfPath, Buffer.from(doc.output('arraybuffer')));
    const { page, context, errors } = await openPage();
    let certBody = null;
    await page.route('**/api/udyam/certificate', async (route) => {
      certBody = route.request().postDataJSON();
      return route.fulfill(locked());
    });
    await page.click('#method-pdf');
    await page.setInputFiles('#certificate-file', pdfPath);
    const outcome = await Promise.race([
      page.waitForSelector('.uv-read', { timeout: 120000 }).then(() => 'read'),
      page.waitForSelector('#udyam-error', { timeout: 120000 }).then(async () => 'err: ' + (await page.textContent('#udyam-error'))),
    ]);
    assert(outcome === 'read', outcome);
    const read = await page.textContent('.uv-read');
    assert(read.includes('UDYAM-MH-26-0012345'), 'ocr number: ' + read);
    assert(read.includes('SHREE GANESH ENGINEERING WORKS'), 'ocr name: ' + read);
    await page.click('#certificate-continue');
    await passOtp(page);
    await page.click('#women-51');
    await page.click(verifyBtn);
    await page.waitForSelector('#udyam-preview');
    assert(certBody?.record?.udyam_number === URN, 'certificate payload ' + JSON.stringify(certBody?.record));
    assert(certBody.proof === 'proof-test', 'otp proof sent');
    assert(certBody.women === true, 'ownership answer sent');
    assert((await page.textContent('#udyam-preview')).includes('Read from your certificate'), 'certificate preview');
    assert(await page.isVisible('.ud-lock__blur'), 'blurred report');
    const beforePay = await page.textContent('body');
    assert(!beforePay.includes('Shed No. 12'), 'address stays hidden until payment');
    await completePayment(page);
    assert((await page.getAttribute('#w-yes', 'aria-pressed')) === 'true', 'women ownership carried into the report');
    const csp = await page.evaluate(() => window.__csp);
    assert(csp.length === 0, 'CSP violations: ' + csp.join(', '));
    assert(errors.length === 0, errors.join('\n'));
    await context.close();
  });

  await test('a saved lead opens the report without Cashfree or payment', async () => {
    const { page, context, calls } = await openPage();
    await page.route('**/api/udyam/lead', (route) => route.fulfill(json(200, {
      ok: true, cached: true, data: RECORD, women: true, source: 'udyam_number',
    })));
    assert((await page.textContent('#method-number')).includes('699'), 'number price');
    assert((await page.textContent('#method-pdf')).includes('499'), 'certificate price');
    await chooseNumber(page);
    await page.fill(urnInput, URN);
    await page.click('#udyam-continue');
    await page.waitForSelector('#udyam-details');
    assert(calls.length === 0, 'Cashfree verify was not called');
    assert(!(await page.$('#udyam-preview')), 'payment preview stays hidden');
    assert(!(await page.$('#otp-phone')), 'otp stays hidden');
    assert((await page.textContent('#report .rname')).trim() === 'Shree Ganesh Engineering Works', 'saved report');
    assert((await page.getAttribute('#w-yes', 'aria-pressed')) === 'true', 'saved ownership');
    await context.close();
  });

  await browser.close();
  server.stop();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
