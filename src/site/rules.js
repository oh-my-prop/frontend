// Rules page. With `?program=<code>&version=<n>` it renders the full rule
// explanation generated from that spec; without it, a list of programs.

import * as api from '../trader/api.js';
import { programName } from '../trader/view.js';
import { el, showMessage } from './dom.js';
import { OFFLINE_NOTICE, PAID_NOTICE, leaderboardHref, parseProgramQuery, rulesDocument, rulesHref, sortPrograms } from './view.js';

const $ = (id) => document.getElementById(id);

function failText(result) {
  if (result.code === 'offline') return OFFLINE_NOTICE;
  if (result.status === 404) return '해당 상품 또는 규칙 버전을 찾을 수 없습니다. 주소의 상품 코드와 버전을 확인하세요.';
  return result.message;
}

async function showIndex(body) {
  const list = await api.listPrograms();
  if (!list.ok || !Array.isArray(list.programs)) return showMessage(body, failText(list), 'error');
  if (list.programs.length === 0) return showMessage(body, '아직 등록된 상품이 없습니다.');
  body.replaceChildren(
    el('h2', { class: 'visually-hidden', text: '상품 목록' }),
    el('ul', { class: 'link-list' }, sortPrograms(list.programs).map((program) => el('li', {},
      el('a', { href: rulesHref(program.program, program.version) },
        el('strong', { text: `${programName(program.program)} · 규칙 버전 v${program.version}` }),
        el('span', { text: program.free ? '무료 시즌' : PAID_NOTICE }),
      )))),
  );
}

function instrumentTable(instruments) {
  return el('div', { class: 'table-wrap' },
    el('table', {},
      el('caption', { text: '거래 가능 종목과 체결 조건(가상 체결)' }),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: '종목' }),
        el('th', { scope: 'col', class: 'num', text: '수수료' }),
        el('th', { scope: 'col', class: 'num', text: '슬리피지' }),
        el('th', { scope: 'col', class: 'num', text: '최대 레버리지' }),
      )),
      el('tbody', {}, instruments.map((item) => el('tr', {},
        el('td', { text: item.symbol }),
        el('td', { class: 'num', text: item.feeText }),
        el('td', { class: 'num', text: item.slippageText }),
        el('td', { class: 'num', text: item.leverageText }),
      ))),
    ),
  );
}

async function showProgram(body, query) {
  const [result, list] = await Promise.all([api.getProgram(query.program, query.version), api.listPrograms()]);
  if (!result.ok || !result.spec) return showMessage(body, failText(result), 'error');
  const doc = rulesDocument(result);
  const summary = list.ok ? list.programs?.find((item) => item.program === doc.code && item.version === doc.version) : null;
  const free = summary?.free ?? false;

  document.title = `${doc.name} 규칙 v${doc.version} | Oh My Prop`;
  $('rules-title').textContent = `${doc.name} 규칙`;
  body.replaceChildren(
    el('div', { class: 'rule-meta' },
      el('p', {}, el('strong', { text: '상품 코드 ' }), el('code', { text: doc.code })),
      el('p', {}, el('strong', { text: '규칙 버전 ' }), el('span', { text: `v${doc.version}` })),
      el('p', {}, el('strong', { text: '버전 해시(SHA-256) ' }), el('code', { title: '계정을 열 때 동의하는 해시와 같습니다', text: doc.sha })),
      el('p', { text: doc.balanceText }),
      doc.resetText ? el('p', { class: 'muted', text: doc.resetText }) : null,
      doc.description ? el('p', { class: 'muted', text: doc.description }) : null,
      summary && !free ? el('p', { class: 'card-status soon' }, el('span', { 'aria-hidden': 'true', text: '◷' }), el('span', { text: PAID_NOTICE })) : null,
    ),
    ...doc.phases.map((phase) => el('section', { class: 'phase', 'aria-labelledby': `phase-${phase.id}` },
      el('h3', { id: `phase-${phase.id}`, text: `${phase.label} 단계 규칙` }),
      el('ul', { class: 'rule-list' }, phase.rules.map((rule) => el('li', {}, el('strong', { text: rule.title }), rule.detail ? el('span', { text: rule.detail }) : null))),
    )),
    doc.instruments.length ? el('section', { class: 'phase', 'aria-label': '종목' }, el('h3', { text: '종목과 체결 조건' }), instrumentTable(doc.instruments)) : null,
    el('p', { class: 'card-links section-foot' },
      el('a', { href: '/rules.html', text: '← 전체 상품 규칙' }),
      free ? el('a', { href: leaderboardHref(doc.code, doc.version), text: '시즌 순위표' }) : null,
      free ? el('a', { href: '/trader.html', text: '이 규칙으로 참가하기' }) : null,
    ),
  );
}

const body = $('rules-body');
const query = parseProgramQuery(location.search);
if (query) showProgram(body, query);
else showIndex(body);
