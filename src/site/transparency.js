// Transparency page: 상품별 결과 통계를 GET /api/v2/stats/public 응답 그대로 그린다
// (전략 03 §4.3 "통계 공개").
//
// 이 화면의 규칙 하나: **없는 숫자를 만들지 않는다.** 서버가 표본 부족(계정 5개 미만)
// 으로 수치를 null로 보내면 그 줄에는 숫자가 아니라 이유를 적는다. 서버에 붙지 못하면
// 안내 문구만 띄운다(다른 공개 화면과 같다).

import * as api from '../trader/api.js';
import { el, showMessage } from './dom.js';
import { SMALL_SAMPLE_REASON, STATS_EMPTY_TEXT, STATS_OFFLINE_NOTICE, publicStatsView } from './view.js';

const $ = (id) => document.getElementById(id);

const COLUMNS = [
  { key: 'accountsText', label: '계정' },
  { key: 'tradedText', label: '거래 시작' },
  { key: 'runningText', label: '진행 중' },
  { key: 'passedText', label: '통과' },
  { key: 'breachedText', label: '위반 종료' },
  { key: 'expiredText', label: '기간 만료' },
  { key: 'passRateText', label: '통과율' },
];

function failText(result) {
  if (result.code === 'offline') return STATS_OFFLINE_NOTICE;
  if (result.status === 404) return '이 서버에는 공개 통계 경로가 아직 없습니다. 서버를 갱신한 뒤 다시 확인해 주세요.';
  return result.message;
}

function nameCell(row) {
  return el('th', { scope: 'row' },
    el('strong', { class: 'row-name', text: row.name }),
    el('span', { class: 'small muted block', text: row.versionText }),
    el('span', { class: 'card-links' }, el('a', { href: row.rulesHref, text: '규칙 전문' })),
  );
}

function statsRow(row) {
  if (row.small) {
    return el('tr', {}, nameCell(row),
      el('td', { colspan: String(COLUMNS.length), class: 'empty-cell' },
        el('strong', { text: `${STATS_EMPTY_TEXT}.` }),
        el('span', { class: 'small muted block', text: SMALL_SAMPLE_REASON }),
      ));
  }
  return el('tr', {}, nameCell(row), ...COLUMNS.map((column) => el('td', { class: 'num', text: row[column.key] })));
}

function table(rows) {
  return el('div', { class: 'table-wrap' },
    el('table', {},
      el('caption', { text: '상품별 계정 결과. 통과율 = 통과 ÷ (통과 + 위반 종료 + 기간 만료). 종료된 계정이 없으면 "—"입니다.' }),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: '상품' }),
        ...COLUMNS.map((column) => el('th', { scope: 'col', class: 'num', text: column.label })),
      )),
      el('tbody', {}, rows.map(statsRow)),
    ),
  );
}

async function load() {
  const body = $('stats-body');
  const result = await api.getPublicStats();
  if (!result.ok) return showMessage(body, failText(result), 'error');

  const view = publicStatsView(result);
  if (view.rows.length === 0) return showMessage(body, '아직 등록된 상품이 없습니다.');

  const generated = view.generatedAtText ? el('p', { class: 'small muted', text: `집계 시각 ${view.generatedAtText} · 최대 1분 전 수치입니다.` }) : null;
  const summary = view.shown === 0
    ? el('p', { class: 'status-msg', role: 'status', text: `${STATS_EMPTY_TEXT}. ${SMALL_SAMPLE_REASON} 시즌이 쌓이면 이 자리에 상품별 수치가 올라옵니다.` })
    : null;
  body.replaceChildren(...[generated, summary, table(view.rows)].filter(Boolean));
}

load();
