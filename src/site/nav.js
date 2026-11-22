// Shared header and footer for the public pages (home, academy, leaderboard,
// rules, legal). Each page has `<div id="site-header">` / `<div id="site-footer">`
// placeholders and `<body data-page="...">` naming the current page; this module
// swaps the placeholders for real markup. The link lists are plain data so the
// link test can check every target exists.

import { el } from './dom.js';

export const NAV_LINKS = [
  { id: 'home', href: '/', text: '홈' },
  { id: 'academy', href: '/academy/', text: '아카데미' },
  { id: 'journal', href: '/academy/journal.html', text: '연습장' },
  { id: 'leaderboard', href: '/leaderboard.html', text: '순위표' },
  { id: 'rules', href: '/rules.html', text: '규칙' },
];

export const CTA_LINK = { id: 'trader', href: '/trader.html', text: '트레이더 화면' };

export const FOOTER_LINKS = [
  { id: 'terms', href: '/legal/terms.html', text: '이용약관(초안)' },
  { id: 'privacy', href: '/legal/privacy.html', text: '개인정보 처리방침(초안)' },
  { id: 'rules', href: '/rules.html', text: '상품 규칙' },
  { id: 'academy', href: '/academy/', text: '아카데미' },
];

export const FOOTER_NOTICE = '모든 계정은 시뮬레이션 계정이며 실제 시장에 주문이 전달되지 않습니다. 종목·방향·시점을 추천하지 않습니다.';

function navItem(link, current) {
  const attrs = { class: 'omp-nav-link', href: link.href, text: link.text };
  if (link.id === current) attrs['aria-current'] = 'page';
  return el('li', {}, el('a', attrs));
}

export function buildHeader(current) {
  return el('header', { class: 'omp-header' },
    el('a', { class: 'omp-skip', href: '#main', text: '본문으로 건너뛰기' }),
    el('div', { class: 'omp-header-inner' },
      el('a', { class: 'omp-logo', href: '/' }, el('span', { class: 'omp-logo-mark', 'aria-hidden': 'true', text: 'P' }), el('span', { text: 'OH MY PROP' })),
      el('nav', { class: 'omp-nav', 'aria-label': '사이트 메뉴' },
        el('ul', { class: 'omp-nav-list' }, NAV_LINKS.map((link) => navItem(link, current)))),
      el('a', { class: 'omp-cta', href: CTA_LINK.href, text: CTA_LINK.text }),
    ),
  );
}

export function buildFooter(current) {
  return el('footer', { class: 'omp-footer' },
    el('div', { class: 'omp-footer-inner' },
      el('p', { class: 'omp-footer-brand', text: 'OH MY PROP · 무료 시즌 챌린지 베타' }),
      el('p', { class: 'omp-footer-notice', text: FOOTER_NOTICE }),
      el('nav', { 'aria-label': '사이트 정보' },
        el('ul', { class: 'omp-footer-list' }, FOOTER_LINKS.map((link) => navItem(link, current)))),
      el('p', { class: 'omp-footer-legal', text: '운영자: [사업자 정보 확정 필요]' }),
    ),
  );
}

export function renderSiteChrome(doc = document) {
  const current = doc.body?.dataset.page ?? '';
  doc.getElementById('site-header')?.replaceWith(buildHeader(current));
  doc.getElementById('site-footer')?.replaceWith(buildFooter(current));
}

// Module scripts run after parsing, so the placeholders already exist.
if (typeof document !== 'undefined') renderSiteChrome(document);
