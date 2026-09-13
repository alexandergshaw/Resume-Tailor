// Lane A self-test rows (design A-14, ledger T3-L19; T3-S9-4). `selfTest.check` is the module that
// exists specifically to fire under a broken extractor or broken verdict logic - so it needs its OWN
// direct test. Before this file, no `.test.js` in this directory imported `./selfTest.js` at all
// (confirmed by grep), which meant gutting `check` to `return { ok: true }` unconditionally changed
// nothing across the whole suite. Real M-21 recordings, same technique verdict.test.js already uses.
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './selfTest.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const DOWN = '↓';

function load(tag) {
  const record = JSON.parse(readFileSync(join(FIX, `${tag}.vitest.json`), 'utf8'));
  const stdout = readFileSync(join(FIX, `${tag}.stdout.txt`), 'utf8');
  const first = record.testResults[0].name.replace(/\\/g, '/');
  const root = first.slice(0, first.lastIndexOf('/hello-world/') + '/hello-world'.length);
  return { record, stdout, root };
}

// The same "cut" technique verdict.test.js uses to force a7Check's INCONCLUSIVE(d): deleting t02's
// ↓ line makes it unclassified, so the class tally no longer equals the recorded pass/fail/skip counts.
function brokenG28() {
  const g28 = load('g28');
  const stdout = g28.stdout.split('\n').filter((l) => !(l.includes(DOWN) && l.includes('t02.'))).join('\n');
  return { ...g28, stdout };
}

describe('A-14 self-test (T3-S9-4)', () => {
  test('check: every recording passes a7Check -> { ok: true } (happy path, real recordings)', () => {
    const g24 = load('g24-runA');
    const g25 = load('g25');
    const result = check([
      { record: g24.record, stdout: g24.stdout, root: g24.root, tag: 'g24-runA' },
      { record: g25.record, stdout: g25.stdout, root: g25.root, tag: 'g25' },
    ]);
    expect(result).toEqual({ ok: true });
  });

  test('check: the first recording that fails a7Check stops the loop, reporting ITS tag and a7Check\'s own reason', () => {
    const g24 = load('g24-runA');
    const broken = brokenG28();
    const result = check([
      { record: g24.record, stdout: g24.stdout, root: g24.root, tag: 'g24-runA' },
      { record: broken.record, stdout: broken.stdout, root: broken.root, tag: 'g28-broken' },
    ]);
    expect(result).toEqual({ ok: false, reason: 'g28-broken', detail: 'd' });
  });

  test('check: a broken recording with no tag reports "unknown", not the tag of a later good one', () => {
    const broken = brokenG28();
    const g25 = load('g25');
    const result = check([
      { record: broken.record, stdout: broken.stdout, root: broken.root },
      { record: g25.record, stdout: g25.stdout, root: g25.root, tag: 'g25' },
    ]);
    expect(result).toEqual({ ok: false, reason: 'unknown', detail: 'd' });
  });

  test('check: an empty recordings list is vacuously ok (never iterates, never throws)', () => {
    expect(check([])).toEqual({ ok: true });
  });
});
