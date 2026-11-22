// Home page: current free season summary and program comparison cards.

import * as api from '../trader/api.js';
import { el, showMessage } from './dom.js';
import { OFFLINE_NOTICE, programCard, sortPrograms } from './view.js';

const $ = (id) => document.getElementById(id);

function chipList(chips) {
  return el('ul', { class: 'chips', 'aria-label': '핵심 규칙' }, chips.map((chip) => el('li', { class: `chip ${chip.tone}`, text: chip.text })));
}

function cardNode(card) {
  return el('article', { class: `program-card ${card.free ? 'free' : 'paid'}`, 'aria-labelledby': `program-${card.code}` },
    el('div', { class: 'program-top' },
      el('span', { class: `tag ${card.free ? 'free' : 'paid'}`, text: card.kindText }),
      el('span', { class: 'muted small', text: card.phasesText }),
    ),
    el('h3', { id: `program-${card.code}`, text: card.name }),
    el('p', { class: 'balance', text: card.balanceText }),
    el('p', { class: 'muted', text: card.pitch }),
    card.chips.length ? chipList(card.chips) : null,
    el('p', { class: `card-status ${card.status.kind}` }, el('span', { 'aria-hidden': 'true', text: card.status.symbol }), el('span', { text: card.status.text })),
    el('p', { class: 'card-links' },
      el('a', { href: card.rulesHref, text: '규칙 전문 보기' }),
      card.leaderboardHref ? el('a', { href: card.leaderboardHref, text: '순위표' }) : null,
      card.canJoin ? el('a', { href: '/trader.html', text: '참가하기' }) : null,
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
  else $('program-list').replaceChildren(...cards.map(cardNode));
}

load();
