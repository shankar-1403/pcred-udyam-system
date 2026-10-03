#!/usr/bin/env node
// Copies the monthly-updated scheme data and central scheme rules from the original
// Udyam Scheme Report page (the Claude artifact) into this project.
//
//   npm run sync:artifact -- path/to/udyam-scheme-report.html
//
// Updates src/data/states.json, src/data/extras.json and the "scheme rules" block
// (plus VERIFIED) in src/report/engine.js. Run `npm test && npm run build` afterwards.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) {
  console.error('Usage: npm run sync:artifact -- <path to the report HTML>');
  process.exit(1);
}
const html = readFileSync(resolve(src), 'utf8');

function dataBlock(id) {
  const m = html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`));
  if (!m) throw new Error(`Data block #${id} not found in ${src}`);
  return JSON.parse(m[1]);
}

const START = '/* --------------------------------------------------------- scheme rules */';
const END = '/* ------------------------------------- state, sector, export and startup data */';
function rulesRange(text, label) {
  const i = text.indexOf(START);
  const j = text.indexOf(END);
  if (i < 0 || j < i) throw new Error(`Scheme-rules markers not found in ${label}`);
  return [i, j];
}

const states = dataBlock('data-states');
const extras = dataBlock('data-extras');
if (!Array.isArray(states.states) || states.states.length < 30) throw new Error('data-states looks incomplete');
if (!Array.isArray(extras.items) || extras.items.length < 10) throw new Error('data-extras looks incomplete');

const [ai, aj] = rulesRange(html, src);
const rules = html.slice(ai, aj);
const verified = html.match(/const VERIFIED = '([^']+)';/);
if (!verified) throw new Error('VERIFIED date not found');

const enginePath = join(root, 'src/report/engine.js');
const before = readFileSync(enginePath, 'utf8');
const [ei, ej] = rulesRange(before, 'src/report/engine.js');
let engine = before.slice(0, ei) + rules + before.slice(ej);
engine = engine.replace(/const VERIFIED = '[^']+';/, `const VERIFIED = '${verified[1]}';`);

// Syntax check before writing anything.
const tmp = mkdtempSync(join(tmpdir(), 'udyam-sync-'));
try {
  const probe = join(tmp, 'engine.mjs');
  writeFileSync(probe, engine);
  const check = spawnSync(process.execPath, ['--check', probe], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`Updated engine does not parse:\n${check.stderr}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(join(root, 'src/data/states.json'), JSON.stringify(states, null, 2) + '\n');
writeFileSync(join(root, 'src/data/extras.json'), JSON.stringify(extras, null, 2) + '\n');
writeFileSync(enginePath, engine);

console.log(`Synced from ${src}`);
console.log(`  states: ${states.states.length} (checked ${states.checked})`);
console.log(`  extras: ${extras.items.length} (checked ${extras.checked})`);
console.log(`  central rules: ${before === engine ? 'unchanged' : 'updated'} (VERIFIED ${verified[1]})`);
