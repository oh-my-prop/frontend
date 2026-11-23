// Season leaderboard: a selector over free programs and a ranked table.

import * as api from '../trader/api.js';
import { programName } from '../trader/view.js';
import { el, showMessage } from './dom.js';
import { OFFLINE_NOTICE, leaderboardRows, parseProgramQuery, rulesHref, sortPrograms } from './view.js';

const $ = (id) => document.getElementById(id);
const optionValue = (program) => `${program.program}@${program.version}`;

function table(rows) {
  return el('div', { class: 'table-wrap' },
    el('table', {},
      el('caption', { text: '규칙을 지킨 계정만 · 수익률 높은 순' }),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', class: 'num', text: '순위' }),
        el('th', { scope: 'col', text: '참가자' }),
        el('th', { scope: 'col', class: 'num', text: '수익률' }),
        el('th', { scope: 'col', class: 'num', text: '거래일' }),
        el('th', { scope: 'col', text: '상태' }),
      )),
      el('tbody', {}, rows.map((row) => el('tr', {},
        el('td', { class: 'num', text: String(row.rank) }),
        el('td', { text: row.label }),
        // The sign (+/−) carries the direction; color only repeats it.
        el('td', { class: `num ret ${row.direction}`, text: row.returnText }),
        el('td', { class: 'num', text: row.tradingDaysText }),
        el('td', {}, el('span', { class: `badge ${row.badge.kind}` }, el('span', { 'aria-hidden': 'true', text: row.badge.symbol }), el('span', { text: row.badge.text }))),
      ))),
    ),
  );
}

async function showBoard(program) {
  $('rules-link').href = rulesHref(program.program, program.version);
  const board = $('board');
  showMessage(board, '순위를 불러오는 중입니다…');
  const result = await api.getLeaderboard(program.program, program.version);
  if (!result.ok) return showMessage(board, result.code === 'offline' ? OFFLINE_NOTICE : result.message, 'error');
  const rows = leaderboardRows(result.leaderboard);
  if (rows.length === 0) return showMessage(board, '아직 순위에 오른 계정이 없습니다. 시즌 계정을 열고 첫 거래를 해 보세요.');
  board.replaceChildren(table(rows));
}

async function load() {
  const select = $('program-select');
  const list = await api.listPrograms();
  if (!list.ok || !Array.isArray(list.programs)) {
    select.replaceChildren(el('option', { value: '', text: '불러오지 못함' }));
    return showMessage($('board'), OFFLINE_NOTICE, 'error');
  }
  const seasons = sortPrograms(list.programs).filter((program) => program.free);
  if (seasons.length === 0) {
    select.replaceChildren(el('option', { value: '', text: '무료 시즌 없음' }));
    return showMessage($('board'), '지금 열린 무료 시즌이 없습니다.');
  }
  select.replaceChildren(...seasons.map((program) => el('option', { value: optionValue(program), text: `${programName(program.program)} (v${program.version})` })));
  const wanted = parseProgramQuery(location.search);
  const initial = seasons.find((program) => wanted && program.program === wanted.program && program.version === wanted.version) ?? seasons[0];
  select.value = optionValue(initial);
  select.disabled = false;
  select.addEventListener('change', () => {
    const program = seasons.find((item) => optionValue(item) === select.value);
    if (!program) return;
    history.replaceState(null, '', `?program=${encodeURIComponent(program.program)}&version=${program.version}`);
    showBoard(program);
  });
  $('program-form').addEventListener('submit', (event) => event.preventDefault());
  await showBoard(initial);
}

load();
