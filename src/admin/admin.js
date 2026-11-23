// Operations console controller. Same-origin, session cookie; the server decides
// who may see what (role + two-factor) and audits every single-account read.
// DOM built with createElement/textContent only (CSP: no inline script/style).

import { describeEvent } from '../trader/view.js';
import { formatCents, formatTimestamp } from '../trader/format.js';
import { formatKrw, orderStatusView } from '../trader/checkout-view.js';
import { ORDER_STATUS_FILTERS, ledgerRows, moneyAlerts, moneyOrderRow, reserveView } from './money-view.js';
import { mountThemeToggle } from '../ui/theme.js';

const $ = (id) => document.getElementById(id);
const STATUS_TEXT = { active: '진행 중', passed: '통과', breached: '위반 종료', expired: '기간 만료', withdrawn: '철회', open: '대기', upheld: '유지', overturned: '번복' };
const VERDICT_TEXT = { breached: '위반 종료', paused: '당일 정지', expired: '기간 만료', phase_passed: '단계 통과', resumed: '정지 해제' };
const ACTION_TEXT = { 'account.view': '계정 열람', 'account.verify': '판정 재현 검사', 'appeal.create': '이의 제기', 'appeal.decide': '이의 결정', 'role.grant': '권한 부여', 'role.revoke': '권한 회수', 'mfa.enable': '2단계 인증 켬', 'mfa.disable': '2단계 인증 끔', 'login.mfa': '2단계 로그인', 'risk.report': '탐지 결과 수신' };

const state = { staff: null, view: 'overview', selected: null };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

let toastTimer = null;
function toast(text, tone = 'normal') {
  const node = $('page-status');
  node.textContent = text;
  node.dataset.tone = tone;
  node.hidden = !text;
  clearTimeout(toastTimer);
  if (text) toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
}

async function call(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  try {
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, ...payload };
    return { ok: false, status: response.status, message: payload?.error?.message ?? '서버 오류가 발생했습니다.' };
  } catch {
    return { ok: false, status: 0, message: '서버에 연결할 수 없습니다.' };
  }
}

const percent = (bps) => {
  if (bps === null || bps === undefined) return '—';
  const sign = bps < 0 ? '−' : bps > 0 ? '+' : '';
  const abs = Math.abs(bps);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}%`;
};
const badge = (status) => el('span', { class: 'badge', 'data-status': status, text: STATUS_TEXT[status] ?? status });

// ---- navigation -----------------------------------------------------------------

function show(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const name of ['overview', 'accounts', 'appeals', 'money', 'risk', 'audit']) $(`view-${name}`).hidden = name !== view;
  ({ overview: loadOverview, accounts: loadAccounts, appeals: loadAppeals, money: loadMoney, risk: loadRisk, audit: loadAudit })[view]();
}

// ---- overview ---------------------------------------------------------------------

async function loadOverview() {
  const result = await call('GET', '/api/v2/admin/overview');
  if (!result.ok) return toast(result.message, 'warning');
  const accounts = result.accounts ?? {};
  const total = Object.values(accounts).reduce((a, b) => a + b, 0);
  const stat = (label, value, help) => el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), el('strong', { text: String(value) }), el('span', { class: 'stat-help', text: help }));
  $('overview-stats').replaceChildren(
    stat('가입자', result.users, '전체 사용자'),
    stat('거래 계정', total, `진행 중 ${accounts.active ?? 0} · 통과 ${accounts.passed ?? 0}`),
    stat('위반 종료', accounts.breached ?? 0, `기간 만료 ${accounts.expired ?? 0}`),
    stat('대기 중인 이의', result.openAppeals, '결정이 필요한 건'),
    stat('부정거래 표시', result.riskReport ? result.riskReport.flagged : '—', result.riskReport ? `그룹 ${result.riskReport.groups} · ${formatTimestamp(result.riskReport.createdAt)}` : '아직 탐지 결과 없음'),
  );
  $('appeal-count').textContent = result.openAppeals ? String(result.openAppeals) : '';
  const market = result.market;
  $('market-health').textContent = market
    ? `${market.symbols}개 종목 중 ${market.ok}개 정상. 가장 오래된 시세 ${market.worstAgeMs === null ? '없음(받은 적 없는 종목 있음)' : `${(market.worstAgeMs / 1000).toFixed(1)}초 전`} · 주문 거부 기준 ${market.maxQuoteAgeMs / 1000}초`
    : '시세 정보 없음';
  const verdicts = Object.entries(result.verdicts24h ?? {});
  $('verdict-stats').replaceChildren(...(verdicts.length
    ? verdicts.map(([kind, n]) => el('span', { class: 'chip', text: `${VERDICT_TEXT[kind] ?? kind} ${n}` }))
    : [el('span', { class: 'muted', text: '없음' })]));
}

// ---- accounts ---------------------------------------------------------------------

async function loadAccounts() {
  const status = $('account-status').value;
  const result = await call('GET', `/api/v2/admin/accounts${status ? `?status=${status}` : ''}`);
  if (!result.ok) return toast(result.message, 'warning');
  $('account-rows').replaceChildren(...(result.accounts.length ? result.accounts.map((account) => el('tr', {
    tabindex: '0',
    onclick: () => openAccount(account.id),
    onkeydown: (event) => { if (event.key === 'Enter') openAccount(account.id); },
  },
  el('td', { class: 'num', text: String(account.id) }),
  el('td', { text: account.user ?? '—' }),
  el('td', { text: `${account.program} v${account.version} · ${account.phase}` }),
  el('td', {}, badge(account.status), account.paused ? el('span', { class: 'muted small', text: ' 정지' }) : null),
  el('td', { class: `num ${account.returnBps < 0 ? 'neg' : account.returnBps > 0 ? 'pos' : ''}`, text: percent(account.returnBps) }),
  el('td', { class: 'num', text: String(account.tradingDays ?? 0) }),
  el('td', { text: formatTimestamp(account.createdAt) }),
  )) : [el('tr', {}, el('td', { colspan: '7', class: 'empty', text: '해당하는 계정이 없습니다.' }))]));
}

async function openAccount(id) {
  const result = await call('GET', `/api/v2/admin/accounts/${id}`);
  if (!result.ok) return toast(result.message, 'warning');
  state.selected = id;
  const { account, events, appeals } = result;
  $('account-detail').hidden = false;
  $('verify-result').hidden = true;
  $('detail-title').textContent = `계정 #${account.id} · ${account.user ?? ''}`;
  const facts = [
    ['상품', `${account.program} v${account.version} (${account.rulesSha256.slice(0, 12)})`],
    ['단계', account.phase],
    ['상태', `${STATUS_TEXT[account.status] ?? account.status}${account.paused ? ' · 당일 정지' : ''}`],
    ['잔고 / 에쿼티', `${formatCents(account.balanceCents)} / ${formatCents(account.equityCents)}`],
    ['포지션', account.positions.length ? account.positions.map((p) => `${p.symbol} ${p.side === 'long' ? '매수' : '매도'} ${p.qty} @ ${p.averagePrice}`).join(', ') : '없음'],
    ['개설 / 종료', `${formatTimestamp(account.createdAt)} / ${account.closedAt ? formatTimestamp(account.closedAt) : '—'}`],
    ['이의 제기', appeals.length ? appeals.map((a) => `#${a.id} ${STATUS_TEXT[a.status]}`).join(', ') : '없음'],
  ];
  $('detail-facts').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
  $('detail-events').replaceChildren(...[...events].reverse().slice(0, 300).map((event) => el('li', {},
    el('span', { class: 'seq', text: `#${event.seq}` }),
    el('span', { text: describeEvent(event) }),
    el('time', { text: formatTimestamp(event.ts) }),
  )));
  $('account-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function verifyReplay() {
  if (!state.selected) return;
  const button = $('verify-replay');
  button.disabled = true;
  const result = await call('POST', `/api/v2/admin/accounts/${state.selected}/verify`);
  button.disabled = false;
  if (!result.ok) return toast(result.message, 'warning');
  const node = $('verify-result');
  node.hidden = false;
  node.dataset.match = String(result.match);
  node.textContent = result.match
    ? `일치 — 입력 기록을 현재 엔진으로 다시 계산한 이벤트 ${result.replayedEvents}개가 저장된 ${result.storedEvents}개와 모두 같습니다.`
    : `불일치 — 기록 #${result.firstMismatchSeq}부터 다릅니다(저장 ${result.storedEvents}개, 재계산 ${result.replayedEvents}개). 엔진 변경이나 데이터 손상을 조사해야 합니다.`;
}

// ---- appeals ------------------------------------------------------------------------

async function loadAppeals() {
  const status = $('appeal-filter').value;
  const result = await call('GET', `/api/v2/admin/appeals${status ? `?status=${status}` : ''}`);
  if (!result.ok) return toast(result.message, 'warning');
  $('appeal-list').replaceChildren(...(result.appeals.length ? result.appeals.map(appealCard) : [el('p', { class: 'empty', text: '해당하는 이의 제기가 없습니다.' })]));
}

function appealCard(appeal) {
  const note = el('textarea', { rows: '3', maxlength: '2000', 'aria-label': `이의 #${appeal.id} 결정 사유` });
  const error = el('p', { class: 'form-error', role: 'alert' });
  const decide = async (decision, button) => {
    button.disabled = true;
    const result = await call('POST', `/api/v2/admin/appeals/${appeal.id}/decision`, { decision, note: note.value });
    button.disabled = false;
    if (!result.ok) return void (error.textContent = result.message);
    toast(decision === 'overturned' ? `번복했습니다${result.appeal.reissuedAccountId ? ` — 새 계정 #${result.appeal.reissuedAccountId} 발급` : ''}.` : '판정을 유지했습니다.');
    loadAppeals();
    loadOverview();
  };
  return el('article', { class: 'card' },
    el('h3', {}, `이의 #${appeal.id} · 계정 `, el('a', { href: '#', onclick: (event) => { event.preventDefault(); show('accounts'); openAccount(appeal.accountId); }, text: `#${appeal.accountId}` }), ' · 판정 기록 ', `#${appeal.eventSeq} `, badge(appeal.status)),
    el('p', { class: 'muted small', text: `접수 ${formatTimestamp(appeal.createdAt)}${appeal.decidedAt ? ` · 결정 ${formatTimestamp(appeal.decidedAt)}` : ''}` }),
    el('p', { class: 'reason', text: appeal.reason }),
    appeal.status === 'open'
      ? el('div', { class: 'decision' },
        el('label', { text: '결정 사유 (트레이더에게 그대로 보입니다)' }), note,
        el('div', { class: 'decision-actions' },
          el('button', { class: 'ghost-btn', type: 'button', text: '판정 유지', onclick: (event) => decide('upheld', event.currentTarget) }),
          el('button', { class: 'primary-btn', type: 'button', text: '판정 번복 · 새 계정 발급', onclick: (event) => decide('overturned', event.currentTarget) }),
        ),
        error)
      : el('p', { text: `결정: ${appeal.decisionNote}${appeal.reissuedAccountId ? ` (새 계정 #${appeal.reissuedAccountId})` : ''}` }),
  );
}

// ---- risk ---------------------------------------------------------------------------

async function loadRisk() {
  const result = await call('GET', '/api/v2/admin/risk');
  if (!result.ok) return toast(result.message, 'warning');
  const report = result.report;
  if (!report) {
    $('risk-meta').textContent = '아직 받은 탐지 결과가 없습니다.';
    $('risk-groups').replaceChildren();
    $('risk-rows').replaceChildren();
    return;
  }
  $('risk-meta').textContent = `${report.source} · 생성 ${report.generatedAt ? formatTimestamp(report.generatedAt) : '—'} · 수신 ${formatTimestamp(report.createdAt)} · 대상 ${report.queue.length}개`;
  const KIND = { hedge: '계정 간 헤지', copy: '카피 거래', mixed: '혼합' };
  $('risk-groups').replaceChildren(...(report.groups.length ? report.groups.map((group) => el('article', { class: 'card' },
    el('h3', { text: `${KIND[group.kind] ?? group.kind} · 증거 ${group.evidence}건` }),
    el('p', {}, ...group.members.flatMap((id, i) => [i ? ', ' : '', el('a', { href: '#', onclick: (event) => { event.preventDefault(); show('accounts'); openAccount(id); }, text: `#${id}` })])),
  )) : [el('p', { class: 'empty', text: '연결된 그룹이 없습니다.' })]));
  $('risk-rows').replaceChildren(...report.queue.slice(0, 100).map((entry, index) => el('tr', { tabindex: '0', onclick: () => { show('accounts'); openAccount(entry.accountId); } },
    el('td', { class: 'num', text: String(index + 1) }),
    el('td', { class: 'num', text: `#${entry.accountId}` }),
    el('td', { text: entry.via === 'link' ? '연결' : '행동' }),
    el('td', { class: 'num', text: entry.behaviourScore === null ? '—' : entry.behaviourScore.toFixed(3) }),
    el('td', { text: entry.reasons.join(' / ') || '—' }),
  )));
}

// ---- audit --------------------------------------------------------------------------

async function loadAudit() {
  const result = await call('GET', '/api/v2/admin/audit');
  if (!result.ok) {
    $('audit-rows').replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'empty', text: result.message })));
    return;
  }
  $('audit-rows').replaceChildren(...result.entries.map((entry) => el('tr', {},
    el('td', { text: formatTimestamp(entry.at) }),
    el('td', { text: entry.actorUserId === null ? '시스템/CLI' : `#${entry.actorUserId}` }),
    el('td', { text: ACTION_TEXT[entry.action] ?? entry.action }),
    el('td', { text: entry.target ?? '—' }),
    el('td', { class: 'small', text: Object.keys(entry.detail).length ? JSON.stringify(entry.detail) : '' }),
  )));
}

// ---- money (결제·원장) ----------------------------------------------------------------

// 조회 전용이다. 서버에 환불·취소 경로가 없고(ops-api.js:250-264), 운영자가 금액을
// 움직이는 길은 만들지 않는다. 여기서 답해야 하는 것은 "어디까지 진행됐는가"뿐이다.
async function loadMoney() {
  const status = $('money-status').value;
  const result = await call('GET', `/api/v2/admin/money${status ? `?status=${status}` : ''}`);
  if (!result.ok) {
    $('money-rows').replaceChildren(el('tr', {}, el('td', { colspan: '7', class: 'empty', text: result.message })));
    $('money-alerts').replaceChildren();
    $('money-stats').replaceChildren();
    $('ledger-rows').replaceChildren();
    return toast(result.message, 'warning');
  }
  const reserve = reserveView(result.reserve);
  const alerts = moneyAlerts(result);
  $('money-alerts').replaceChildren(...alerts.map((alert) => el('article', { class: 'card alert', 'data-tone': alert.tone, role: 'alert' },
    el('h3', { text: alert.text }),
    alert.detail ? el('p', { class: 'small muted', text: alert.detail }) : null,
  )));
  const stat = (label, value, help, tone) => el('div', { class: 'stat', 'data-tone': tone ?? null },
    el('span', { class: 'stat-label', text: label }),
    el('strong', { text: value }),
    el('span', { class: 'stat-help', text: help }));
  const paidWithoutAccount = result.orders.filter((order) => order.status === 'paid' && !order.accountId).length;
  $('money-stats').replaceChildren(
    stat('주문', String(result.orders.length), status ? '거른 결과' : '최근 200건'),
    stat('결제 완료·계정 없음', String(paidWithoutAccount), '0이어야 정상입니다', paidWithoutAccount ? 'danger' : null),
    stat('아웃박스 대기', String(result.outbox?.pending ?? 0), '처리를 기다리는 작업'),
    stat('데드레터', String(result.outbox?.deadLetters ?? 0), '재시도를 포기한 작업', (result.outbox?.deadLetters ?? 0) ? 'danger' : null),
    stat('미정산 저널', String(result.unbalancedJournals?.length ?? 0), '합이 0이 아닌 분개', (result.unbalancedJournals?.length ?? 0) ? 'danger' : null),
  );
  $('reserve-line').textContent = reserve.help;
  $('reserve-line').dataset.tone = reserve.tone;
  $('reserve-facts').replaceChildren(
    el('dt', { text: '신규 펀딩 승급' }),
    el('dd', {}, el('span', { class: 'badge', 'data-status': reserve.halted ? 'breached' : 'active', text: reserve.halted ? '중단됨' : '정상' })),
    el('dt', { text: '준비금' }), el('dd', { class: 'krw-cell', text: formatKrw(result.reserve?.reserveKrw ?? 0) }),
    el('dt', { text: '미지급 추정액' }), el('dd', { class: 'krw-cell', text: formatKrw(result.reserve?.outstandingKrw ?? 0) }),
    el('dt', { text: '승인·미송금' }), el('dd', { class: 'krw-cell', text: formatKrw(result.reserve?.approvedUnpaidKrw ?? 0) }),
    el('dt', { text: '소진율' }), el('dd', { text: reserve.ratioText }),
  );
  const ledger = ledgerRows(result.ledger);
  $('ledger-rows').replaceChildren(...(ledger.length ? ledger.map((row) => el('tr', {},
    el('td', { text: row.label }),
    el('td', {}, el('code', { class: 'small', text: row.account })),
    el('td', { class: 'num krw-cell', text: formatKrw(row.amountKrw) }),
  )) : [el('tr', {}, el('td', { colspan: '3', class: 'empty', text: '분개가 아직 없습니다.' }))]));
  $('money-rows').replaceChildren(...(result.orders.length ? result.orders.map(moneyOrderRow).map((row) => el('tr', {},
    el('td', {}, el('code', { class: 'small', text: row.orderId })),
    el('td', {},
      el('span', { class: 'badge', 'data-tone': orderStatusView(row.status).tone, text: orderStatusView(row.status).label }),
      row.failureCode ? el('p', { class: 'small muted', text: row.failureCode }) : null),
    el('td', { class: 'num krw-cell', text: formatKrw(row.amountKrw) }),
    el('td', { class: 'small', text: row.productText }),
    el('td', { class: 'num', text: row.userId === null ? '—' : `#${row.userId}` }),
    el('td', { class: row.warn ? 'warn-cell' : '' }, row.accountId
      ? el('button', { class: 'link-btn', type: 'button', text: `#${row.accountId}`, onclick: () => { show('accounts'); openAccount(row.accountId); } })
      : el('span', { text: row.accountText })),
    el('td', { class: 'small', text: formatTimestamp(row.updatedAt ?? row.createdAt) }),
  )) : [el('tr', {}, el('td', { colspan: '7', class: 'empty', text: '해당하는 주문이 없습니다.' }))]));
}

// ---- boot ---------------------------------------------------------------------------

async function boot() {
  mountThemeToggle($('theme-slot'));
  const me = await call('GET', '/api/v2/admin/me');
  if (!me.ok) {
    $('locked').hidden = false;
    $('locked-reason').textContent = me.status === 401 ? '로그인이 필요합니다.' : me.message;
    return;
  }
  state.staff = me.user;
  $('staff-label').textContent = `${me.user.email} · ${me.user.role === 'admin' ? '관리자' : '검토자'}`;
  $('audit-tab').hidden = me.user.role !== 'admin';
  $('console').hidden = false;
  for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => show(tab.dataset.view));
  $('account-status').addEventListener('change', loadAccounts);
  $('account-search').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const id = Number(event.target.value.trim());
    if (Number.isSafeInteger(id) && id > 0) openAccount(id);
  });
  $('verify-replay').addEventListener('click', verifyReplay);
  $('appeal-filter').addEventListener('change', loadAppeals);
  $('money-status').replaceChildren(...ORDER_STATUS_FILTERS.map((option) => el('option', { value: option.value, text: option.label })));
  $('money-status').addEventListener('change', loadMoney);
  show('overview');
}

boot();
