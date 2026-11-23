// Banned-phrase check (product spec §5, compliance 03 §4.5): no page or UI
// module may contain a phrase from src/site/banned-phrases.js, except the
// explicit file+sentence pairs in its ALLOWLIST.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, BANNED_PHRASES, findBannedPhrases } from '../src/site/banned-phrases.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'src/site/banned-phrases.js';
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(relative(ROOT, path).split(sep).join('/'));
  }
  return out;
}

const files = walk(ROOT).filter((file) => file.endsWith('.html') || (file.startsWith('src/') && file.endsWith('.js') && file !== SELF));
const allowedFor = (file) => ALLOWLIST.filter((entry) => entry.file === file).map((entry) => entry.text);

test('scan covers every page and UI module', () => {
  for (const expected of ['index.html', 'faq.html', 'transparency.html', 'academy/index.html', 'academy/journal.html', 'leaderboard.html', 'rules.html', 'legal/terms.html', 'legal/privacy.html', 'trader.html', 'src/trader/view.js', 'src/site/view.js']) {
    assert.ok(files.includes(expected), `${expected} is scanned`);
  }
});

test('no banned phrase in any page or UI module', () => {
  const failures = [];
  for (const file of files) {
    const hits = findBannedPhrases(readFileSync(join(ROOT, file), 'utf8'), allowedFor(file));
    for (const hit of hits) failures.push(`${file}:${hit.line} "${hit.phrase}" — ${hit.excerpt}`);
  }
  assert.deepEqual(failures, []);
});

test('allowlist is minimal: legal pages only, negated, and still present', () => {
  for (const entry of ALLOWLIST) {
    assert.match(entry.file, /^legal\/[^/]+\.html$/, `${entry.file} must be a legal page`);
    assert.ok(entry.reason, 'each entry documents why it is allowed');
    assert.ok(findBannedPhrases(entry.text).length > 0, `"${entry.text}" contains a banned phrase (otherwise it needs no entry)`);
    assert.match(entry.text, /않습니다|없습니다|아닙니다/, `"${entry.text}" is a negated sentence`);
    assert.ok(readFileSync(join(ROOT, entry.file), 'utf8').includes(entry.text), `"${entry.text}" still appears in ${entry.file}`);
  }
});

test('matcher catches variants and only skips the exact allowed sentence', () => {
  assert.deepEqual(findBannedPhrases('투자자문 서비스').map((hit) => hit.phrase), ['투자 자문']);
  assert.ok(BANNED_PHRASES.includes('증권사'));
  const allowed = '원금을 보장하지 않습니다';
  assert.deepEqual(findBannedPhrases(`${allowed}`, [allowed]), []);
  assert.deepEqual(findBannedPhrases(`${allowed}\n원금 보장 상품`, [allowed]).map((hit) => hit.line), [2, 2, 2]);
});
