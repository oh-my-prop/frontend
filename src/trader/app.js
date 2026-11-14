// Trader dashboard controller. DOM is built with createElement/textContent only.

import * as api from './api.js';
import { formatCents, formatSignedCents, formatTimestamp } from './format.js';
import { describeEvent, describeRule, limitCards, objectiveCards, phaseLabel, statusBanner, stopLossPreview } from './view.js';

const $ = (id) => document.getElementById(id);
const QUOTE_POLL_MS = 3000;
const LOG_LIMIT = 200;

const state = {
  user: null,
  registerMode: false,
  programs: [],
  specs: new Map(), // "code@version" -> { rulesSha256, spec }
  accounts: [],
  current: null, // { account, spec, phase, events }
  quotes: new Map(),
  closeStream: null,
  quoteTimer: null,
  pendingOrder: null, // { key, body } kept when a send failed to reach the server
  rendered: { positions: null, orders: null, activity: null }, // structure keys of the last rebuild
};

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

function setStatus(text, tone = 'normal') {
  const node = $('page-status');
  node.textContent = text;
  node.dataset.tone = tone;
  node.hidden = !text;
}

const specKey = (program, version) => `${program}@${version}`;

// ---- auth ---------------------------------------------------------------------

function renderAuth() {
  $('auth').hidden = Boolean(state.user);
  $('programs').hidden = !state.user;
  $('accounts').hidden = !state.user;
  $('logout').hidden = !state.user;
  $('user-label').textContent = state.user ? state.user.email : '';
  $('auth-title').textContent = state.registerMode ? '계정 만들기' : '로그인';
  $('auth-submit').textContent = state.registerMode ? '계정 만들기' : '로그인';
  $('auth-toggle').textContent = state.registerMode ? '로그인으로 전환' : '계정 만들기로 전환';
  $('auth-password').autocomplete = state.registerMode ? 'new-password' : 'current-password';
}

async function submitAuth(event) {
  event.preventDefault();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const result = state.registerMode ? await api.register(email, password) : await api.login(email, password);
  if (!result.ok) {
    $('auth-error').textContent = result.message;
    return;
  }
  $('auth-error').textContent = '';
  $('auth-password').value = '';
  state.user = result.user;
  renderAuth();
  await loadWorkspace();
}

async function doLogout() {
  await api.logout();
  closeDashboard();
  state.user = null;
  state.accounts = [];
  renderAuth();
  setStatus('로그아웃했습니다.');
}

// ---- programs and accounts ------------------------------------------------

async function loadWorkspace() {
  const [programs, accounts, quotes] = await Promise.all([api.listPrograms(), api.listAccounts(), api.getQuotes()]);
  if (!programs.ok) return setStatus(programs.message, 'warning');
  state.programs = programs.programs;
  await Promise.all(state.programs.map(async (program) => {
    const spec = await api.getProgram(program.program, program.version);
    if (spec.ok) state.specs.set(specKey(program.program, program.version), spec);
  }));
  if (quotes.ok) for (const quote of quotes.quotes) state.quotes.set(quote.symbol, quote);
  state.accounts = accounts.ok ? accounts.accounts : [];
  renderPrograms();
  renderAccounts();
  setStatus('');
}

function renderPrograms() {
  const list = $('program-list');
  list.replaceChildren(...state.programs.map((program) => {
    const entry = state.specs.get(specKey(program.program, program.version));
    const spec = entry?.spec;
    const phases = (spec?.phases ?? []).map((phase) => el('details', {},
      el('summary', { text: `${phaseLabel(phase.id)} 규칙 (${phase.rules.length}개)` }),
      el('ul', { class: 'rule-list' }, phase.rules.map((rule) => {
        const { title, detail } = describeRule(rule, spec.initialBalanceCents);
        return el('li', {}, el('strong', { text: title }), el('span', { text: detail }));
      })),
    ));
    const checkbox = el('input', { type: 'checkbox', id: `accept-${program.program}` });
    const button = el('button', { class: 'primary-button', type: 'button', text: '계정 열기', disabled: !program.available });
    checkbox.disabled = !program.available;
    button.disabled = true;
    checkbox.addEventListener('change', () => { button.disabled = !checkbox.checked || !program.available; });
    button.addEventListener('click', () => openAccount(program, button));
    return el('article', { class: 'program-card' },
      el('p', { class: 'eyebrow', text: `${program.free ? '무료 시즌' : '유료 평가'} · v${program.version}` }),
      el('h3', { text: program.program }),
      el('p', { class: 'help', text: program.description ?? '' }),
      el('p', { class: 'meta', text: `가상 잔고 ${formatCents(program.initialBalanceCents)} · 단계 ${program.phases.map(phaseLabel).join(' → ')}` }),
      ...phases,
      program.available
        ? el('label', { class: 'accept', for: checkbox.id }, checkbox, ` 규칙 전문을 확인했습니다 (규칙 버전 ${program.rulesSha256.slice(0, 12)})`)
        : el('p', { class: 'unavailable', text: '아직 제공하지 않는 상품입니다(출시 준비 중).' }),
      button,
    );
  }));
}

async function openAccount(program, button) {
  button.disabled = true;
  const result = await api.openAccount(program.program, program.version, program.rulesSha256);
  if (!result.ok) {
    setStatus(result.message, 'warning');
    // Rules changed under us: reload so the user reads the current version.
    if (result.code === 'rules_changed') await loadWorkspace();
    else button.disabled = false;
    return;
  }
  state.accounts.push(result);
  renderAccounts();
  setStatus('계정을 열었습니다.');
  await selectAccount(result.id);
}

function renderAccounts() {
  const list = $('account-list');
  if (state.accounts.length === 0) {
    list.replaceChildren(el('p', { class: 'help', text: '아직 계정이 없습니다. 위 상품에서 규칙을 확인하고 계정을 여세요.' }));
    return;
  }
  list.replaceChildren(...[...state.accounts].reverse().map((account) => el('button', {
    class: `account-row${state.current?.account.id === account.id ? ' selected' : ''}`,
    type: 'button',
    onclick: () => selectAccount(account.id),
  },
  el('span', { text: `#${account.id} ${account.program} · ${phaseLabel(account.phase)}` }),
  el('span', { class: `pill ${account.status}`, text: statusText(account) }),
  el('span', { text: formatCents(account.equityCents) }),
  )));
}

function statusText(account) {
  if (account.status === 'active') return account.paused ? '당일 정지' : '진행 중';
  return { breached: '위반 종료', passed: '통과', expired: '만료' }[account.status] ?? account.status;
}

// ---- dashboard ----------------------------------------------------------------

function closeDashboard() {
  state.rendered = { positions: null, orders: null, activity: null };
  state.closeStream?.();
  state.closeStream = null;
  clearInterval(state.quoteTimer);
  state.current = null;
  state.pendingOrder = null;
  $('dashboard').hidden = true;
}

async function selectAccount(id) {
  closeDashboard();
  const [account, events] = await Promise.all([api.getAccount(id), api.getEvents(id)]);
  if (!account.ok) return setStatus(account.message, 'warning');
  const entry = state.specs.get(specKey(account.program, account.version));
  if (!entry) return setStatus('상품 규칙을 불러오지 못했습니다.', 'warning');
  const phase = entry.spec.phases.find((item) => item.id === account.phase);
  state.current = { account, spec: entry.spec, phase, events: events.ok ? events.events : [] };
  $('dashboard').hidden = false;
  renderInstruments();
  renderDashboard();
  renderAccounts();
  if (account.status === 'active') {
    state.closeStream = api.openStream(id, {
      onSnapshot: (snapshot) => {
        if (state.current?.account.id !== id) return;
        state.current.account = { ...state.current.account, ...snapshot };
        renderDashboard();
        updateAccountRow(state.current.account);
      },
      onEvent: (event) => {
        if (state.current?.account.id !== id) return;
        if (state.current.events.some((item) => item.seq === event.seq)) return;
        state.current.events.push(event);
        if (event.type === 'verdict' && event.verdict === 'phase_passed') refreshAccounts();
      },
      onStatus: renderStreamStatus,
    });
    state.quoteTimer = setInterval(refreshQuotes, QUOTE_POLL_MS);
  } else {
    renderStreamStatus('closed');
  }
  $('dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function refreshAccounts() {
  const result = await api.listAccounts();
  if (result.ok) {
    state.accounts = result.accounts;
    renderAccounts();
  }
}

function updateAccountRow(account) {
  const index = state.accounts.findIndex((item) => item.id === account.id);
  if (index >= 0) state.accounts[index] = { ...state.accounts[index], ...account };
  renderAccounts();
}

async function refreshQuotes() {
  const result = await api.getQuotes();
  if (!result.ok) return;
  for (const quote of result.quotes) state.quotes.set(quote.symbol, quote);
  renderQuote();
  renderPreview();
}

function renderStreamStatus(status) {
  const text = {
    live: '실시간 갱신 중',
    reconnecting: '실시간 갱신 중단 — 다시 연결하는 중',
    closed: state.current?.account.status === 'active' ? '실시간 갱신 중단' : '종료된 계정',
    unsupported: '이 브라우저는 실시간 갱신을 지원하지 않습니다',
  }[status] ?? status;
  const node = $('stream-status');
  node.textContent = text;
  node.dataset.state = status;
}

function renderDashboard() {
  const { account, spec, phase } = state.current;
  $('dash-meta').textContent = `${account.program} v${account.version} · ${phaseLabel(account.phase)} · 규칙 ${account.rulesSha256.slice(0, 12)}`;
  $('dash-title').textContent = `계정 #${account.id}`;
  const banner = statusBanner(account);
  $('dash-banner').textContent = banner.text;
  $('dash-banner').dataset.tone = banner.tone;

  const unrealized = account.positions.reduce((sum, position) => sum + position.unrealizedPnlCents, 0);
  $('sum-balance').textContent = formatCents(account.balanceCents);
  $('sum-equity').textContent = formatCents(account.equityCents);
  $('sum-unrealized').textContent = formatSignedCents(unrealized);
  $('sum-unrealized').dataset.sign = Math.sign(unrealized);
  $('sum-days').textContent = `${account.tradingDays}일`;

  const limits = limitCards(phase.rules, account.rules, spec.initialBalanceCents);
  $('limit-cards').replaceChildren(...(limits.length ? limits.map((card) => el('article', { class: `limit-card ${card.warning}${card.nearest ? ' nearest' : ''}` },
    el('p', { class: 'card-title', text: card.title }),
    el('strong', { text: card.remainingCents > 0 ? formatCents(card.remainingCents) : '도달' }),
    el('p', { class: 'card-sub', text: `한도선 ${formatCents(card.lineCents)}${card.nearest ? ' · 가장 가까운 한도' : ''}` }),
    el('p', { class: 'card-sub', text: card.consequence === 'pause' ? '도달 시: 당일 거래 정지' : '도달 시: 계정 종료' }),
  )) : [el('p', { class: 'help', text: '첫 체결 또는 시세 갱신 후 표시됩니다.' })]));

  const objectives = objectiveCards(phase.rules, account.rules, spec.initialBalanceCents);
  $('objective-cards').replaceChildren(...(objectives.length ? objectives.map((card) => el('article', { class: `objective-card${card.met ? ' met' : ''}` },
    el('p', { class: 'card-title', text: card.title }),
    progressBar(card.percent),
    el('p', { class: 'card-sub', text: card.text }),
  )) : [el('p', { class: 'help', text: '이 단계에는 달성 목표가 없습니다(시즌은 순위로 평가).' })]));

  renderPositions();
  renderOrders();
  renderActivity();
  renderQuote();
  renderPreview();
  const active = account.status === 'active' && !account.paused;
  for (const node of $('order-form').elements) node.disabled = !active;
}

// The CSP forbids inline style attributes; CSSOM property writes are allowed.
function progressBar(percent) {
  const fill = el('span');
  fill.style.width = `${percent}%`;
  return el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) }, fill);
}

// Snapshots arrive about once a second. Tables with buttons are rebuilt only when
// their rows change; otherwise only the moving numbers are updated in place, so a
// button is never replaced under the user's pointer.
function renderPositions() {
  const { account } = state.current;
  const key = `${account.status}|${account.positions.map((position) => `${position.symbol}:${position.side}:${position.qty}:${position.averagePrice}`).join(',')}`;
  if (key === state.rendered.positions) {
    for (const position of account.positions) {
      const cell = $('positions').querySelector(`td[data-pnl="${CSS.escape(position.symbol)}"]`);
      if (!cell) continue;
      cell.textContent = formatSignedCents(position.unrealizedPnlCents);
      cell.dataset.sign = String(Math.sign(position.unrealizedPnlCents));
    }
    return;
  }
  state.rendered.positions = key;
  if (account.positions.length === 0) {
    $('positions').replaceChildren(el('p', { class: 'help', text: '보유 포지션이 없습니다.' }));
    return;
  }
  $('positions').replaceChildren(el('table', {},
    el('thead', {}, el('tr', {}, ['종목', '방향', '수량', '평균가', '평가손익', ''].map((text) => el('th', { scope: 'col', text })))),
    el('tbody', {}, account.positions.map((position) => el('tr', {},
      el('td', { text: position.symbol }),
      el('td', { text: position.side === 'long' ? '롱' : '숏' }),
      el('td', { text: position.qty }),
      el('td', { text: position.averagePrice }),
      el('td', { 'data-pnl': position.symbol, 'data-sign': String(Math.sign(position.unrealizedPnlCents)), text: formatSignedCents(position.unrealizedPnlCents) }),
      el('td', {}, el('button', { class: 'secondary-button small', type: 'button', text: '시장가 청산', disabled: account.status !== 'active', onclick: (event) => closePosition(position.symbol, event.currentTarget) })),
    ))),
  ));
}

function renderOrders() {
  const { account } = state.current;
  const key = account.openOrders.map((order) => order.orderId).join(',');
  if (key === state.rendered.orders) return;
  state.rendered.orders = key;
  if (account.openOrders.length === 0) {
    $('open-orders').replaceChildren(el('p', { class: 'help', text: '미체결 주문이 없습니다.' }));
    return;
  }
  const typeText = { limit: '지정가', stop: '스톱', market: '시장가' };
  $('open-orders').replaceChildren(el('table', {},
    el('thead', {}, el('tr', {}, ['종목', '방향', '유형', '수량', '가격', ''].map((text) => el('th', { scope: 'col', text })))),
    el('tbody', {}, account.openOrders.map((order) => el('tr', {},
      el('td', { text: order.symbol }),
      el('td', { text: order.side === 'buy' ? '매수' : '매도' }),
      el('td', { text: `${typeText[order.orderType]}${order.reduceOnly ? ' (청산 전용)' : ''}` }),
      el('td', { text: order.qty }),
      el('td', { text: order.price ?? '' }),
      el('td', {}, el('button', { class: 'secondary-button small', type: 'button', text: '취소', onclick: (event) => cancelOrder(order.orderId, event.currentTarget) })),
    ))),
  ));
}

function renderVerdicts() {
  const verdicts = state.current.events.filter((event) => event.type === 'verdict');
  if (verdicts.length === 0) {
    $('verdicts').replaceChildren(el('p', { class: 'help', text: '판정 기록이 없습니다.' }));
    return;
  }
  $('verdicts').replaceChildren(...verdicts.map((event) => el('article', { class: `verdict-card ${event.verdict}` },
    el('strong', { text: describeEvent(event) }),
    el('p', { class: 'card-sub', text: `${event.ruleId ? `규칙 ${event.ruleId} · ` : ''}${formatTimestamp(event.ts)} · 근거 이벤트 #${event.seq}` }),
  )));
}

function renderActivity() {
  const lastSeq = state.current.events.at(-1)?.seq ?? 0;
  if (lastSeq === state.rendered.activity) return;
  state.rendered.activity = lastSeq;
  renderVerdicts();
  const events = state.current.events.slice(-LOG_LIMIT).reverse();
  $('activity').replaceChildren(...events.map((event) => el('li', {},
    el('span', { class: 'seq', text: `#${event.seq}` }),
    el('span', { text: describeEvent(event) }),
    el('time', { text: formatTimestamp(event.ts) }),
  )));
}

// ---- order entry ------------------------------------------------------------------

function renderInstruments() {
  const select = $('order-symbol');
  select.replaceChildren(...state.current.spec.instruments.map((item) => el('option', { value: item.symbol, text: item.symbol })));
}

const currentInstrument = () => state.current?.spec.instruments.find((item) => item.symbol === $('order-symbol').value);
const currentSide = () => document.querySelector('input[name="side"]:checked').value;

function renderQuote() {
  if (!state.current) return;
  const quote = state.quotes.get($('order-symbol').value);
  $('order-quote').textContent = quote?.status === 'ok' ? `매수호가 ${quote.bid} · 매도호가 ${quote.ask}` : '시세가 없거나 지연 중입니다. 주문을 받을 수 없습니다.';
}

function orderBody() {
  const body = { symbol: $('order-symbol').value, side: currentSide(), type: $('order-type').value, qty: $('order-qty').value.trim() };
  if (body.type !== 'market') body.price = $('order-price').value.trim();
  const stopLoss = $('order-sl').value.trim();
  const takeProfit = $('order-tp').value.trim();
  if (stopLoss) body.stopLoss = stopLoss;
  if (takeProfit) body.takeProfit = takeProfit;
  return body;
}

function renderPreview() {
  if (!state.current) return;
  $('order-price-wrap').hidden = $('order-type').value === 'market';
  const body = orderBody();
  const quote = state.quotes.get(body.symbol);
  const entryPrice = body.type === 'market' ? (body.side === 'buy' ? quote?.ask : quote?.bid) : body.price;
  const daily = limitCards(state.current.phase.rules, state.current.account.rules, state.current.spec.initialBalanceCents).find((card) => card.kind === 'daily_loss');
  const preview = stopLossPreview({ instrument: currentInstrument(), side: body.side, qty: body.qty, entryPrice, stopLoss: body.stopLoss, dailyRemainingCents: daily?.remainingCents });
  const node = $('order-preview');
  if (!preview.available) {
    node.textContent = preview.reason;
    node.dataset.tone = 'normal';
    return;
  }
  const after = preview.remainingAfterCents == null ? ''
    : preview.reachesLimit ? ' 이 손실이면 일일 손실 한도에 도달합니다.' : ` 그 뒤 일일 한도 잔여: ${formatCents(preview.remainingAfterCents)}.`;
  node.textContent = `손절가에서 체결되면 약 ${formatCents(preview.lossCents)} 손실(수수료·슬리피지 포함).${after} 가격이 손절가를 건너뛰면 손실은 더 커질 수 있습니다.`;
  node.dataset.tone = preview.reachesLimit ? 'danger' : 'normal';
}

async function submitOrder(event) {
  event.preventDefault();
  const body = orderBody();
  // Retry with the same key only if the previous identical send never got an answer.
  const pending = state.pendingOrder && JSON.stringify(state.pendingOrder.body) === JSON.stringify(body) ? state.pendingOrder : null;
  $('order-submit').disabled = true;
  const result = await api.placeOrder(state.current.account.id, body, pending?.key);
  $('order-submit').disabled = false;
  const message = $('order-message');
  if (!result.ok) {
    if (result.code === 'offline') {
      state.pendingOrder = { key: result.key, body };
      message.textContent = '응답을 받지 못했습니다. 같은 주문을 다시 보내도 두 번 체결되지 않습니다.';
    } else {
      state.pendingOrder = null;
      message.textContent = result.message;
    }
    message.dataset.tone = 'danger';
    return;
  }
  state.pendingOrder = null;
  message.textContent = result.replayed ? '이미 접수된 주문입니다.' : '주문을 접수했습니다.';
  message.dataset.tone = 'success';
  $('order-qty').value = '';
  $('order-price').value = '';
  $('order-sl').value = '';
  $('order-tp').value = '';
  applyCommandResult(result);
}

function applyCommandResult(result) {
  if (!state.current || !result.snapshot) return;
  state.current.account = { ...state.current.account, ...result.snapshot };
  renderDashboard();
  updateAccountRow(state.current.account);
  if (result.promotedAccountId) refreshAccounts();
}

async function cancelOrder(orderId, button) {
  button.disabled = true;
  const result = await api.cancelOrder(state.current.account.id, orderId);
  if (!result.ok) {
    button.disabled = false;
    $('order-message').textContent = result.message;
    return;
  }
  applyCommandResult(result);
}

async function closePosition(symbol, button) {
  button.disabled = true;
  const result = await api.closePosition(state.current.account.id, symbol);
  if (!result.ok) {
    button.disabled = false;
    $('order-message').textContent = result.message;
    return;
  }
  applyCommandResult(result);
}

// ---- boot -------------------------------------------------------------------------

async function boot() {
  $('auth-form').addEventListener('submit', submitAuth);
  $('auth-toggle').addEventListener('click', () => {
    state.registerMode = !state.registerMode;
    renderAuth();
  });
  $('logout').addEventListener('click', doLogout);
  $('order-form').addEventListener('submit', submitOrder);
  $('order-form').addEventListener('input', renderPreview);
  $('order-form').addEventListener('change', () => {
    renderQuote();
    renderPreview();
  });

  const me = await api.getMe();
  if (me.code === 'offline') {
    setStatus('서버에 연결할 수 없습니다. 트레이더 대시보드는 백엔드와 같은 출처에서만 동작합니다. 아카데미 기능은 그대로 쓸 수 있습니다.', 'warning');
    return;
  }
  state.user = me.ok ? me.user : null;
  renderAuth();
  if (state.user) await loadWorkspace();
  else setStatus('');
}

boot();
