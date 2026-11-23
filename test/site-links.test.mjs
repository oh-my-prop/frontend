// Every local href/src in every HTML page (and the link lists in the site JS)
// must point at a file that exists; pages must also follow the server CSP
// (module scripts from files only, no inline scripts, styles or handlers).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CTA_LINK, FOOTER_LINKS, NAV_LINKS } from '../src/site/nav.js';
import { leaderboardHref, rulesHref } from '../src/site/view.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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

const htmlFiles = walk(ROOT).filter((file) => file.endsWith('.html'));
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const isExternal = (url) => /^(https?:|mailto:|tel:|data:)/i.test(url);

// Resolve a URL used in `fromFile` to a repo path; `/x` is relative to the site root.
function resolveLocal(url, fromFile) {
  const path = decodeURI(url.split('#')[0].split('?')[0]);
  let target = path.startsWith('/') ? join(ROOT, path) : join(ROOT, dirname(fromFile), path);
  if (path === '') target = join(ROOT, fromFile);
  if (path.endsWith('/') || (existsSync(target) && statSync(target).isDirectory())) target = join(target, 'index.html');
  return target;
}

function references(html) {
  const refs = [];
  for (const match of html.matchAll(/\s(href|src)\s*=\s*(["'])(.*?)\2/g)) refs.push(match[3]);
  for (const match of html.matchAll(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/gi)) refs.push(match[1].trim());
  return refs;
}

test('there are pages to check', () => {
  for (const page of ['index.html', 'faq.html', 'transparency.html', 'academy/index.html', 'academy/journal.html', 'journal.html', 'leaderboard.html', 'rules.html', 'legal/terms.html', 'legal/privacy.html', 'trader.html']) {
    assert.ok(htmlFiles.includes(page), `${page} exists`);
  }
});

test('every local href/src in HTML points at an existing file', () => {
  const missing = [];
  for (const file of htmlFiles) {
    const html = read(file);
    for (const url of references(html)) {
      if (isExternal(url)) continue;
      assert.doesNotMatch(url, /^javascript:/i, `${file}: no javascript: URLs`);
      if (url.startsWith('#')) {
        const id = url.slice(1);
        if (id && !html.includes(`id="${id}"`)) missing.push(`${file}: ${url} (no element with that id)`);
        continue;
      }
      if (!existsSync(resolveLocal(url, file))) missing.push(`${file}: ${url}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('navigation and generated links point at existing files', () => {
  const urls = [...NAV_LINKS, CTA_LINK, ...FOOTER_LINKS].map((link) => link.href);
  urls.push(rulesHref('omp-season-25k', 1), leaderboardHref('omp-season-25k', 1));
  for (const file of walk(join(ROOT, 'src/site')).filter((path) => path.endsWith('.js'))) {
    for (const match of read(file).matchAll(/href:\s*'([^']+)'/g)) urls.push(match[1]);
  }
  for (const url of urls) {
    if (url === '#main') continue; // skip link; every page's <main id="main"> is checked below
    assert.ok(url.startsWith('/'), `${url} is root-relative`);
    assert.ok(existsSync(resolveLocal(url, 'index.html')), `${url} exists`);
  }
});

test('pages follow the CSP: file-based module scripts, no inline script/style/handlers', () => {
  const problems = [];
  for (const file of htmlFiles) {
    const html = read(file);
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      // The one classic script is src/ui/theme-init.js: it has to run before first
      // paint (module scripts are deferred) so the saved theme never flashes.
      const themeInit = /src=["'][^"']*src\/ui\/theme-init\.js["']/.test(match[1]);
      if (!/\bsrc=/.test(match[1]) || (!/type=["']module["']/.test(match[1]) && !themeInit)) problems.push(`${file}: script without src/type=module`);
      if (match[2].trim()) problems.push(`${file}: inline script body`);
    }
    if (/<style\b/i.test(html)) problems.push(`${file}: <style> element`);
    for (const tag of html.match(/<[a-z][^>]*>/gi) ?? []) {
      if (/\sstyle\s*=/i.test(tag)) problems.push(`${file}: inline style attribute in ${tag.slice(0, 60)}`);
      if (/\son[a-z]+\s*=/i.test(tag)) problems.push(`${file}: inline event handler in ${tag.slice(0, 60)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('public pages share the site header and footer', () => {
  for (const file of ['index.html', 'faq.html', 'transparency.html', 'academy/index.html', 'academy/journal.html', 'leaderboard.html', 'rules.html', 'legal/terms.html', 'legal/privacy.html']) {
    const html = read(file);
    assert.match(html, /id="site-header"/, `${file} header placeholder`);
    assert.match(html, /id="site-footer"/, `${file} footer placeholder`);
    assert.match(html, /src="[./]*\/?src\/site\/nav\.js"/, `${file} loads nav.js`);
    assert.match(html, /<body data-page="[a-z]+">/, `${file} names its page`);
    assert.match(html, /<main id="main"/, `${file} has the skip-link target`);
  }
});

test('pages with accounts or rules show the fixed simulation notice', () => {
  for (const file of ['index.html', 'faq.html', 'transparency.html', 'leaderboard.html', 'rules.html']) {
    assert.ok(read(file).includes('시뮬레이션 계정 — 실제 시장에 주문이 전달되지 않습니다'), file);
  }
  for (const file of ['legal/terms.html', 'legal/privacy.html']) {
    assert.ok(read(file).includes('초안 — 법률 검토 전 문서입니다'), `${file} draft banner`);
  }
});
