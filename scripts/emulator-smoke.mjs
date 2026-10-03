#!/usr/bin/env node
// Smoke test of the real wiring: Firebase Hosting emulator → rewrite → udyamVerify function.
// Only sends requests the function rejects before contacting Cashfree.
//
//   npm run build
//   npx firebase emulators:exec --only functions,hosting --project demo-pcred "node scripts/emulator-smoke.mjs"
const BASE = process.env.HOSTING_URL ?? 'http://127.0.0.1:5000';
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const post = (body, headers = {}) =>
  fetch(`${BASE}/api/udyam/verify`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

console.log(`Emulator smoke test against ${BASE}`);
await check('Hosting serves the React app with the security headers', async () => {
  const r = await fetch(`${BASE}/`);
  const html = await r.text();
  expect(r.status === 200 && html.includes('<div id="root">'), `status ${r.status}`);
  expect((r.headers.get('content-security-policy') ?? '').includes("default-src 'self'"), 'missing CSP header');
});
await check('rewrite reaches the function: invalid number → 400 INVALID_UDYAM', async () => {
  const r = await post(JSON.stringify({ udyam: 'UDYAM-MH-18-024500' }));
  const j = await r.json();
  expect(r.status === 400 && j.error?.code === 'INVALID_UDYAM', `${r.status} ${JSON.stringify(j)}`);
  expect(r.headers.get('cache-control')?.includes('no-store'), 'cache-control');
});
await check('malformed JSON → 400', async () => {
  const r = await post('{oops');
  expect(r.status === 400, String(r.status));
});
await check('wrong content type → 415', async () => {
  const r = await post('x', { 'content-type': 'text/plain' });
  expect(r.status === 415, String(r.status));
});
await check('another website → 403', async () => {
  const r = await post(JSON.stringify({ udyam: 'UDYAM-MH-26-0012345' }), { origin: 'https://another-site.example' });
  expect(r.status === 403, String(r.status));
});
await check('GET → 405', async () => {
  const r = await fetch(`${BASE}/api/udyam/verify`);
  expect(r.status === 405, String(r.status));
});
await check('unknown paths fall back to the app (SPA rewrite)', async () => {
  const r = await fetch(`${BASE}/some/deep/link`);
  expect(r.status === 200 && (await r.text()).includes('<div id="root">'), String(r.status));
});
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('All emulator checks passed');
