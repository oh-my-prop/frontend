// Home page: the current free season and the program comparison table.
//
// The table is drawn from the server answer only. 가격은 서버가 `saleState: 'for_sale'`
// 과 함께 `priceKrw`를 줄 때만 그린다. 화면에 숫자를 적어 두지 않으므로, 플래그가
// 꺼진 서버에서는 어떤 금액도 나타날 수 없다(전략 03 §4.5).

import * as api from '../trader/api.js';
import { el, showMessage } from './dom.js';
import { OFFLINE_NOTICE, programCard, sortPrograms } from './view.js';

const $ = (id) => document.getElementById(id);

function chipList(chips) {
  return el('ul', { class: 'chips', 'aria-label': '핵심 규칙' }, chips.map((chip) => el('li', { class: `chip ${chip.tone}`, text: chip.text })));
}

// 한 상품이 지금 할 수 있는 일. 셋 중 하나만 나온다.
function actionCell(card) {
  if (card.canJoin) {
    return el('td', { 'data-label': '지금 할 수 있는 일' },
      el('a', { class: 'btn primary small-btn', href: '/trader.html', text: '무료로 참가하기' }),
      el('span', { class: 'small muted block', text: '가입 후 규칙 버전에 동의하면 계정이 열립니다.' }),
    );
  }
  if (card.canBuy) {
    return el('td', { 'data-label': '지금 할 수 있는 일' },
      el('a', { class: 'btn primary small-btn', href: '/trader.html', text: '구매하고 시작하기' }),
      el('span', { class: 'small muted block', text: '규칙 전문과 청약 철회 조건을 확인한 뒤 결제합니다.' }),
    );
  }
  return el('td', { 'data-label': '지금 할 수 있는 일' },
    el('span', { class: `card-status ${card.status.kind}` }, el('span', { 'aria-hidden': 'true', text: card.status.symbol }), el('span', { text: card.status.text })),
  );
}

function programRow(card) {
  return el('tr', {},
    el('th', { scope: 'row' },
      el('span', { class: `tag ${card.free ? 'free' : 'paid'}`, text: card.kindText }),
      el('strong', { class: 'row-name', text: card.name }),
      el('span', { class: 'small muted block', text: card.pitch }),
      el('span', { class: 'card-links' },
        el('a', { href: card.rulesHref, text: '규칙 전문·버전 해시' }),
        card.leaderboardHref ? el('a', { href: card.leaderboardHref, text: '순위표' }) : null,
      ),
    ),
    el('td', { 'data-label': '가상 잔고 · 단계' }, el('span', { class: 'balance block', text: card.balanceText }), el('span', { class: 'small muted block', text: card.phasesText })),
    el('td', { 'data-label': '핵심 한도' }, card.chips.length ? chipList(card.chips) : el('span', { class: 'small muted', text: '규칙 전문에서 확인하세요.' })),
    el('td', { class: 'price-cell', 'data-label': '가격' }, el('strong', { class: 'block', text: card.priceLabel }), el('span', { class: 'small muted block', text: card.free ? '결제 없음' : card.canBuy ? '1회 결제(원화)' : '법률 검토 후 공개' })),
    actionCell(card),
  );
}

function programTable(cards) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'program-table' },
      el('caption', { text: '상품별 규칙과 가격. 가격은 판매가 열린 상품에만 표시됩니다.' }),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: '상품' }),
        el('th', { scope: 'col', text: '가상 잔고 · 단계' }),
        el('th', { scope: 'col', text: '핵심 한도' }),
        el('th', { scope: 'col', text: '가격' }),
        el('th', { scope: 'col', text: '지금 할 수 있는 일' }),
      )),
      el('tbody', {}, cards.map(programRow)),
    ),
  );
}

function seasonNode(card) {
  return el('div', { class: 'program-card free' },
    el('div', { class: 'program-top' },
      el('span', { class: 'tag free', text: card.kindText }),
      el('span', { class: 'muted small', text: `규칙 버전 v${card.version}` }),
    ),
    el('h3', { text: card.name }),
    el('p', { class: 'balance', text: card.balanceText }),
    el('p', { class: 'muted', text: card.pitch }),
    card.chips.length ? chipList(card.chips) : null,
    el('p', { class: `card-status ${card.status.kind}` }, el('span', { 'aria-hidden': 'true', text: card.status.symbol }), el('span', { text: card.status.text })),
    el('div', { class: 'btn-row' },
      card.canJoin ? el('a', { class: 'btn primary', href: '/trader.html', text: '이 시즌에 참가하기' }) : null,
      el('a', { class: 'btn ghost', href: card.leaderboardHref, text: '시즌 순위표' }),
      el('a', { class: 'btn ghost', href: card.rulesHref, text: '규칙 전문' }),
    ),
  );
}

async function load() {
  const list = await api.listPrograms();
  if (!list.ok || !Array.isArray(list.programs)) {
    showMessage($('season-summary'), OFFLINE_NOTICE, 'error');
    showMessage($('program-list'), `${OFFLINE_NOTICE} 학습 도구는 아카데미에서 계속 쓸 수 있습니다.`, 'error');
    return;
  }
  const programs = sortPrograms(list.programs);
  const specs = await Promise.all(programs.map((program) => api.getProgram(program.program, program.version)));
  const cards = programs.map((program, index) => programCard(program, specs[index].ok ? specs[index].spec : null));

  const seasons = cards.filter((card) => card.free);
  if (seasons.length === 0) showMessage($('season-summary'), '지금 열린 무료 시즌이 없습니다. 다음 시즌은 공지 후 시작합니다.');
  else $('season-summary').replaceChildren(...seasons.map(seasonNode));

  if (cards.length === 0) showMessage($('program-list'), '아직 등록된 상품이 없습니다.');
  else $('program-list').replaceChildren(programTable(cards));
}

load();
