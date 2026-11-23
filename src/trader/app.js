// Trader page controller. DOM is built with createElement/textContent only
// (no innerHTML), and no inline style attributes (the CSP forbids them).

import * as api from './api.js';
import { createCandleChart } from './chart.js';
import { mountThemeToggle } from '../ui/theme.js';
import { mergeCandles, midText } from './chart-scale.js';
import { formatCents, formatSignedCents, formatTimestamp } from './format.js';
import {
  describeEvent, describeRule, limitCards, objectiveCards, orderNotional, phaseLabel,
  programName, programPitch, ruleHighlights, statusBanner, stopLossPreview,
} from './view.js';
import { formatWinRate, tradeReview } from './review.js';
import { adverseVerdict, appealReasonOk, appealStatus, groupSecret, verdictFacts } from './ops-view.js';

const $ = (id) => document.getElementById(id);
const QUOTE_POLL_MS = 2000;
const LOG_LIMIT = 200;
const GUIDE_KEY = 'oh-my-prop.trader-guide-closed';

const state = {
  user: null,
  registerMode: false,
  programs: [],
  specs: new Map(), // "code@version" -> { rulesSha256, spec }
  accounts: [],
  current: null, // { account, spec, phase, events }
  quotes: new Map(),
  previousBid: new Map(), // symbol -> bid before the latest quote, for the up/down tick
  flash: new Map(), // symbol -> { dir: 1 | -1, until: ms } — tint a moved price briefly
  closeStream: null,
  quoteTimer: null,
  pendingOrder: null, // { key, body } kept when a send failed to reach the server
  mfaChallenge: null, // set after a correct password when two-factor is on
  appeals: [],
  chart: null,
  candles: { symbol: null, list: [], loading: null },
  rendered: { positions: null, orders: null, activity: null },
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

let toastTimer = null;
function toast(text, tone = 'normal') {
  const node = $('page-status');
  node.textContent = text;
  node.dataset.tone = tone;
  node.hidden = !text;
  clearTimeout(toastTimer);
  if (text && tone !== 'warning') toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
}

const specKey = (program, version) => `${program}@${version}`;

// ---- auth -------------------------------------------------------------------------

function renderShell() {
  const signedIn = Boolean(state.user);
  $('welcome').hidden = signedIn;
  $('app').hidden = !signedIn;
  $('logout').hidden = !signedIn;
  $('user-label').textContent = signedIn ? state.user.email : '';
  $('security-open').hidden = !signedIn;
  $('admin-link').hidden = !(signedIn && state.user.role);
  $('mfa-step').hidden = !state.mfaChallenge;
  $('auth-email').disabled = Boolean(state.mfaChallenge);
  $('auth-password').disabled = Boolean(state.mfaChallenge);
  $('auth-toggle').hidden = Boolean(state.mfaChallenge);
  $('auth-title').textContent = state.registerMode ? '계정 만들기' : '로그인';
  $('auth-submit').textContent = state.registerMode ? '계정 만들기' : '로그인';
  $('auth-toggle').textContent = state.registerMode ? '이미 계정이 있어요. 로그인' : '처음이신가요? 계정 만들기';
  $('auth-password').autocomplete = state.registerMode ? 'new-password' : 'current-password';
}

async function submitAuth(event) {
  event.preventDefault();
  if (state.mfaChallenge) return submitCode();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const result = state.registerMode ? await api.register(email, password) : await api.login(email, password);
  if (!result.ok) {
    $('auth-error').textContent = result.message;
    return;
  }
  $('auth-error').textContent = '';
  if (result.mfaRequired) {
    state.mfaChallenge = result.challenge;
    renderShell();
    $('auth-code').focus();
    return;
  }
  $('auth-password').value = '';
  state.user = result.user;
  if (!state.user.mfa) state.user = (await api.getMe()).user ?? state.user;
  renderShell();
  await loadWorkspace();
}

async function submitCode() {
  const result = await api.loginTotp(state.mfaChallenge, $('auth-code').value.trim());
  if (!result.ok) {
    $('auth-error').textContent = result.attemptsLeft !== undefined ? `${result.message} (남은 시도 ${result.attemptsLeft}회)` : result.message;
    if (result.restart) {
      state.mfaChallenge = null;
      $('auth-code').value = '';
      renderShell();
    }
    return;
  }
  state.mfaChallenge = null;
  $('auth-error').textContent = '';
  $('auth-password').value = '';
  $('auth-code').value = '';
  state.user = (await api.getMe()).user ?? result.user;
  renderShell();
  await loadWorkspace();
}

// ---- security (two-factor) -----------------------------------------------------------

function showSecurity() {
  closeDashboard();
  $('catalog').hidden = true;
  $('security').hidden = false;
  renderSecurity();
}

function renderSecurity(setup = null) {
  const mfa = state.user?.mfa ?? { enabled: false };
  $('mfa-status').textContent = mfa.enabled ? '켜짐 — 로그인할 때 인증 앱 코드를 묻습니다.' : '꺼짐 — 비밀번호만으로 로그인합니다.';
  $('mfa-status').dataset.on = String(Boolean(mfa.enabled));
  $('mfa-setup').hidden = !setup;
  if (setup) {
    $('mfa-secret').textContent = groupSecret(setup.secret);
    $('mfa-uri').textContent = setup.otpauthUri;
  }
  $('mfa-start').hidden = mfa.enabled || Boolean(setup);
  $('mfa-enable').hidden = mfa.enabled || !setup;
  $('mfa-disable').hidden = !mfa.enabled;
  $('mfa-code-label').hidden = !(setup || mfa.enabled);
  $('mfa-code').hidden = !(setup || mfa.enabled);
  $('mfa-code-label').textContent = mfa.enabled ? '끄려면 현재 6자리 코드를 입력하세요' : '앱에 나온 6자리 코드';
  $('mfa-error').textContent = '';
}

async function startMfa() {
  const result = await api.totpSetup();
  if (!result.ok) return void ($('mfa-error').textContent = result.message);
  renderSecurity(result);
  $('mfa-code').focus();
}

async function submitMfa(event) {
  event.preventDefault();
  const code = $('mfa-code').value.trim();
  const result = await api.totpEnable(code);
  if (!result.ok) return void ($('mfa-error').textContent = result.message);
  state.user = { ...state.user, mfa: result.mfa };
  $('mfa-code').value = '';
  renderSecurity();
  toast('2단계 인증을 켰습니다. 다음 로그인부터 코드를 묻습니다.');
}

async function disableMfa() {
  const result = await api.totpDisable($('mfa-code').value.trim());
  if (!result.ok) return void ($('mfa-error').textContent = result.message);
  state.user = { ...state.user, mfa: result.mfa };
  $('mfa-code').value = '';
  renderSecurity();
  toast('2단계 인증을 껐습니다.', 'warning');
}

async function doLogout() {
  await api.logout();
  closeDashboard();
  state.user = null;
  state.mfaChallenge = null;
  state.accounts = [];
  $('security').hidden = true;
  renderShell();
  toast('로그아웃했습니다.');
}

// ---- workspace ----------------------------------------------------------------------

async function loadWorkspace() {
  const [programs, accounts, quotes] = await Promise.all([api.listPrograms(), api.listAccounts(), api.getQuotes()]);
  if (!programs.ok) return toast(programs.message, 'warning');
  state.programs = programs.programs;
  await Promise.all(state.programs.map(async (program) => {
    const spec = await api.getProgram(program.program, program.version);
    if (spec.ok) state.specs.set(specKey(program.program, program.version), spec);
  }));
  if (quotes.ok) for (const quote of quotes.quotes) state.quotes.set(quote.symbol, quote);
  state.accounts = accounts.ok ? accounts.accounts : [];
  renderPrograms();
  renderAccounts();
  // Land on the most recent live account; with none, start at the catalog.
  const active = [...state.accounts].reverse().find((account) => account.status === 'active');
  if (active) await selectAccount(active.id);
  else showCatalog();
}

function showCatalog() {
  closeDashboard();
  $('security').hidden = true;
  $('catalog').hidden = false;
  renderAccounts();
}

function renderPrograms() {
  // Free and available programs first: that is where a newcomer should start.
  const ordered = [...state.programs].sort((a, b) => Number(b.free) - Number(a.free) || Number(b.available) - Number(a.available));
  $('program-list').replaceChildren(...ordered.map((program) => {
    const entry = state.specs.get(specKey(program.program, program.version));
    const spec = entry?.spec;
    const firstPhase = spec?.phases[0];
    const chips = firstPhase ? ruleHighlights(firstPhase.rules, spec.initialBalanceCents) : [];
    const details = el('details', { class: 'rules-more' },
      el('summary', { text: '전체 규칙 보기' }),
      ...(spec?.phases ?? []).map((phase) => el('div', { class: 'phase-block' },
        el('p', { class: 'phase-name', text: phaseLabel(phase.id) }),
        el('ul', { class: 'rule-list' }, phase.rules.map((rule) => {
          const { title, detail } = describeRule(rule, spec.initialBalanceCents);
          return el('li', {}, el('strong', { text: title }), el('span', { text: detail }));
        })),
      )),
    );
    const checkbox = el('input', { type: 'checkbox', id: `accept-${program.program}` });
    const button = el('button', { class: 'primary-btn', type: 'button', text: '이 규칙으로 계정 열기' });
    checkbox.disabled = !program.available;
    button.disabled = true;
    checkbox.addEventListener('change', () => { button.disabled = !checkbox.checked || !program.available; });
    button.addEventListener('click', () => openAccount(program, button));
    return el('article', { class: `program-card${program.free ? ' featured' : ''}` },
      el('div', { class: 'program-top' },
        el('span', { class: `tag ${program.free ? 'free' : 'paid'}`, text: program.free ? '무료 · 추천' : '유료 평가' }),
        el('span', { class: 'muted small', text: program.phases.map(phaseLabel).join(' → ') }),
      ),
      el('h2', { text: programName(program.program) }),
      el('p', { class: 'balance', text: `가상 잔고 ${formatCents(program.initialBalanceCents)}` }),
      el('p', { class: 'muted', text: programPitch(program.program, program.description ?? '') }),
      el('ul', { class: 'chips' }, chips.map((chip) => el('li', { class: `chip ${chip.tone}`, text: chip.text }))),
      details,
      program.available
        ? el('div', { class: 'program-cta' },
          el('label', { class: 'accept', for: checkbox.id }, checkbox, el('span', { text: '규칙을 읽었고 동의합니다' })),
          button)
        : el('p', { class: 'soon', text: '출시 준비 중 — 아직 열 수 없습니다' }),
    );
  }));
}

async function openAccount(program, button) {
  button.disabled = true;
  const result = await api.openAccount(program.program, program.version, program.rulesSha256);
  if (!result.ok) {
    toast(result.message, 'warning');
    if (result.code === 'rules_changed') await loadWorkspace();
    else button.disabled = false;
    return;
  }
  state.accounts.push(result);
  toast('계정을 열었습니다. 이제 주문해 보세요.');
  await selectAccount(result.id);
}

function statusText(account) {
  if (account.status === 'active') return account.paused ? '오늘 정지' : '진행 중';
  return { breached: '위반 종료', passed: '통과', expired: '만료' }[account.status] ?? account.status;
}

function renderAccounts() {
  const list = $('account-list');
  if (state.accounts.length === 0) {
    list.replaceChildren(el('p', { class: 'muted small empty', text: '아직 계정이 없습니다. 상품을 골라 시작하세요.' }));
    return;
  }
  list.replaceChildren(...[...state.accounts].reverse().map((account) => el('button', {
    class: `account-item${state.current?.account.id === account.id ? ' selected' : ''}`,
    type: 'button',
    onclick: () => selectAccount(account.id),
  },
  el('span', { class: 'account-name', text: programName(account.program) }),
  el('span', { class: 'account-sub', text: `#${account.id} · ${phaseLabel(account.phase)}` }),
  el('span', { class: 'account-equity', text: formatCents(account.equityCents) }),
  el('span', { class: `dot ${account.status}${account.paused ? ' paused' : ''}`, text: statusText(account) }),
  )));
}

// ---- dashboard ---------------------------------------------------------------------

function closeDashboard() {
  state.closeStream?.();
  state.closeStream = null;
  clearInterval(state.quoteTimer);
  state.current = null;
  state.pendingOrder = null;
  state.rendered = { positions: null, orders: null, activity: null };
  $('dashboard').hidden = true;
  $('verdict-card').hidden = true;
  state.appeals = [];
}

// The review needs every fill, so read the log page by page (1,000 per page).
async function loadAllEvents(id) {
  const all = [];
  for (;;) {
    const page = await api.getEvents(id, all.at(-1)?.seq ?? 0);
    if (!page.ok) return all.length ? { ok: true, events: all } : page;
    all.push(...page.events);
    if (page.events.length < 1000) return { ok: true, events: all };
  }
}

async function selectAccount(id) {
  closeDashboard();
  const [account, events] = await Promise.all([api.getAccount(id), loadAllEvents(id)]);
  if (!account.ok) return toast(account.message, 'warning');
  const entry = state.specs.get(specKey(account.program, account.version));
  if (!entry) return toast('상품 규칙을 불러오지 못했습니다.', 'warning');
  const phase = entry.spec.phases.find((item) => item.id === account.phase);
  state.current = { account, spec: entry.spec, phase, events: events.ok ? events.events : [] };
  $('catalog').hidden = true;
  $('security').hidden = true;
  $('dashboard').hidden = false;
  loadAppeals(id);
  renderInstruments();
  renderRuleDetail();
  renderDashboard();
  loadCandles();
  renderAccounts();
  if (account.status === 'active') {
    state.closeStream = api.openStream(id, {
      onSnapshot: (snapshot) => {
        if (state.current?.account.id !== id) return;
        state.current.account = { ...state.current.account, ...snapshot };
        renderDashboard();
        updateAccountItem(state.current.account);
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function refreshAccounts() {
  const result = await api.listAccounts();
  if (result.ok) {
    state.accounts = result.accounts;
    renderAccounts();
  }
}

function updateAccountItem(account) {
  const index = state.accounts.findIndex((item) => item.id === account.id);
  if (index >= 0) state.accounts[index] = { ...state.accounts[index], ...account };
  renderAccounts();
}

async function refreshQuotes() {
  const result = await api.getQuotes();
  if (!result.ok) return;
  for (const quote of result.quotes) {
    const previous = state.quotes.get(quote.symbol);
    if (previous?.bid && previous.bid !== quote.bid) {
      state.previousBid.set(quote.symbol, previous.bid);
      state.flash.set(quote.symbol, { dir: Math.sign(Number(quote.bid) - Number(previous.bid)), until: Date.now() + 600 });
    }
    state.quotes.set(quote.symbol, quote);
  }
  renderMarket();
  renderQuoteLine();
  renderTicket();
  refreshCandles();
}

// ---- chart -------------------------------------------------------------------------

async function loadCandles() {
  const symbol = $('order-symbol').value;
  if (!symbol) return;
  state.chart ??= createCandleChart({ canvas: $('price-chart'), readout: $('chart-readout') });
  state.candles = { symbol, list: [], loading: null };
  $('chart-symbol').textContent = symbol;
  renderChart();
  const result = await api.getCandles(symbol, { limit: 240 });
  if (state.candles.symbol !== symbol || !result.ok) return;
  state.candles.list = result.candles;
  renderChart();
}

// Re-fetch from the newest stored bar on; that bar is replaced by its updated version.
async function refreshCandles() {
  const { symbol, list, loading } = state.candles;
  if (!symbol || loading) return;
  const since = list.at(-1)?.t;
  state.candles.loading = api.getCandles(symbol, { since, limit: since ? 1440 : 240 });
  const result = await state.candles.loading;
  if (state.candles.symbol !== symbol) return;
  state.candles.loading = null;
  if (!result.ok) return;
  state.candles.list = since ? mergeCandles(state.candles.list, result.candles) : result.candles;
  renderChart();
}

function chartLines(symbol) {
  const { account } = state.current;
  const lines = account.positions
    .filter((position) => position.symbol === symbol)
    .map((position) => ({ price: position.averagePrice, kind: 'entry', label: `평균 진입가 (${position.side === 'long' ? '매수' : '매도'} ${position.qty})` }));
  for (const order of account.openOrders) {
    if (order.symbol !== symbol || order.price == null) continue;
    const kind = order.reduceOnly ? (order.orderType === 'stop' ? 'stop' : 'take') : 'order';
    const label = { stop: '손절', take: '익절', order: order.orderType === 'stop' ? '스톱 대기' : '지정가 대기' }[kind];
    lines.push({ price: order.price, kind, label: `${label} ${order.side === 'buy' ? '매수' : '매도'} ${order.qty}` });
  }
  return lines;
}

function renderChart() {
  if (!state.chart || !state.current) return;
  const symbol = state.candles.symbol;
  const instrument = state.current.spec.instruments.find((item) => item.symbol === symbol);
  if (!instrument) return;
  const quote = state.quotes.get(symbol);
  state.chart.update({
    candles: state.candles.list,
    decimals: instrument.priceDecimals,
    lastPrice: quote?.status === 'ok' ? midText(quote.bid, quote.ask, instrument.priceDecimals) : null,
    lines: chartLines(symbol),
  });
}

function renderStreamStatus(status) {
  const text = {
    live: '실시간',
    reconnecting: '연결 끊김 · 다시 연결 중',
    closed: state.current?.account.status === 'active' ? '연결 끊김' : '종료된 계정',
    unsupported: '실시간 미지원 브라우저',
  }[status] ?? status;
  const node = $('stream-status');
  node.textContent = text;
  node.dataset.state = status;
}

function renderDashboard() {
  const { account } = state.current;
  $('dash-meta').textContent = `${phaseLabel(account.phase)} · 계정 #${account.id} · 규칙 ${account.rulesSha256.slice(0, 8)}`;
  $('dash-title').textContent = programName(account.program);
  $('dash-status').textContent = statusText(account);
  $('dash-status').dataset.status = account.paused ? 'paused' : account.status;

  const banner = statusBanner(account);
  $('dash-banner').textContent = banner.tone === 'normal' ? '' : banner.text;
  $('dash-banner').dataset.tone = banner.tone;
  $('dash-banner').hidden = banner.tone === 'normal';

  const traded = state.current.events.some((event) => event.type === 'order_filled');
  $('guide').hidden = traded || account.status !== 'active' || localStorage.getItem(GUIDE_KEY) === '1';

  const unrealized = account.positions.reduce((sum, position) => sum + position.unrealizedPnlCents, 0);
  $('sum-balance').textContent = formatCents(account.balanceCents);
  $('sum-equity').textContent = formatCents(account.equityCents);
  $('sum-unrealized').textContent = formatSignedCents(unrealized);
  $('sum-unrealized').dataset.sign = String(Math.sign(unrealized));
  $('sum-days').textContent = `${account.tradingDays}일`;

  renderGauges();
  renderGoals();
  renderMarket();
  renderPositions();
  renderOrders();
  renderActivity();
  renderQuoteLine();
  renderTicket();
  const tradable = account.status === 'active' && !account.paused;
  for (const node of $('order-form').elements) node.disabled = !tradable;
  renderChart();
}

function renderGauges() {
  const { account, spec, phase } = state.current;
  const cards = limitCards(phase.rules, account.rules, spec.initialBalanceCents);
  $('limit-cards').replaceChildren(...cards.map((card) => {
    const fill = el('span', { class: 'gauge-fill' });
    fill.style.width = `${card.remainingPercent}%`;
    const consequence = card.consequence === 'pause' ? '오늘 거래 정지' : '계정 종료';
    const headline = card.remainingCents > 0
      ? `${formatCents(card.remainingCents)} 더 잃으면 ${consequence}`
      : `한도 도달 — ${consequence}`;
    return el('article', { class: `gauge ${card.warning}${card.nearest ? ' nearest' : ''}` },
      el('div', { class: 'gauge-top' },
        el('span', { class: 'gauge-name', text: card.title.replace(/ \(.*\)$/, '') }),
        card.nearest ? el('span', { class: 'gauge-flag', text: '가장 가까움' }) : null,
      ),
      el('strong', { class: 'gauge-value', text: headline }),
      el('div', { class: 'gauge-bar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(card.remainingPercent), 'aria-label': `${card.title} 남은 비율` }, fill),
      el('p', { class: 'muted small', text: `한도선 ${formatCents(card.lineCents)} · 허용 손실 ${formatCents(card.allowanceCents)} 중 ${card.remainingPercent}% 남음` }),
    );
  }));
}

function renderGoals() {
  const { account, spec, phase } = state.current;
  const goals = objectiveCards(phase.rules, account.rules, spec.initialBalanceCents);
  if (goals.length === 0) {
    $('objective-cards').replaceChildren(el('p', { class: 'muted small', text: '이 단계에는 달성할 목표가 없습니다. 시즌은 규칙을 지킨 계정끼리 수익률 순위로 겨룹니다.' }));
    return;
  }
  $('objective-cards').replaceChildren(...goals.map((goal) => {
    const fill = el('span', { class: 'gauge-fill' });
    fill.style.width = `${goal.percent}%`;
    return el('article', { class: `goal${goal.met ? ' met' : ''}` },
      el('div', { class: 'gauge-top' }, el('span', { class: 'gauge-name', text: goal.title }), goal.met ? el('span', { class: 'gauge-flag ok', text: '달성' }) : null),
      el('div', { class: 'gauge-bar goal-bar' }, fill),
      el('p', { class: 'muted small', text: goal.text }),
    );
  }));
}

function flashClass(symbol) {
  const flash = state.flash.get(symbol);
  if (!flash || Date.now() > flash.until) return '';
  return flash.dir > 0 ? ' flash-up' : flash.dir < 0 ? ' flash-down' : '';
}

function renderMarket() {
  if (!state.current) return;
  $('market').replaceChildren(...state.current.spec.instruments.map((instrument) => {
    const quote = state.quotes.get(instrument.symbol);
    const ok = quote?.status === 'ok';
    const previous = state.previousBid.get(instrument.symbol);
    const direction = ok && previous ? Math.sign(Number(quote.bid) - Number(previous)) : 0;
    return el('button', {
      class: `ticker${$('order-symbol').value === instrument.symbol ? ' selected' : ''}`,
      type: 'button',
      'data-dir': String(direction),
      onclick: () => {
        $('order-symbol').value = instrument.symbol;
        renderMarket();
        loadCandles();
        renderQuoteLine();
        renderQtyPresets();
        renderTicket();
      },
    },
    el('span', { class: 'ticker-symbol', text: instrument.symbol }),
    el('strong', { class: `ticker-price${flashClass(instrument.symbol)}`, text: ok ? `${direction > 0 ? '▲ ' : direction < 0 ? '▼ ' : ''}${quote.bid}` : quote?.stale ? '시세 지연' : '시세 없음' }),
    el('span', { class: 'muted small', text: ok ? `팔 때 ${quote.bid} · 살 때 ${quote.ask}` : '주문할 수 없습니다' }),
    );
  }));
}

// Tables with buttons are rebuilt only when their rows change; otherwise only the
// moving numbers are updated, so a button is never replaced under the pointer.
function renderPositions() {
  const { account } = state.current;
  const key = `${account.status}|${account.positions.map((position) => `${position.symbol}:${position.side}:${position.qty}:${position.averagePrice}`).join(',')}`;
  if (key === state.rendered.positions) {
    for (const position of account.positions) {
      const cell = $('positions').querySelector(`[data-pnl="${CSS.escape(position.symbol)}"]`);
      if (!cell) continue;
      cell.textContent = formatSignedCents(position.unrealizedPnlCents);
      cell.dataset.sign = String(Math.sign(position.unrealizedPnlCents));
    }
    return;
  }
  state.rendered.positions = key;
  if (account.positions.length === 0) {
    $('positions').replaceChildren(el('p', { class: 'muted small', text: '보유 중인 포지션이 없습니다. 주문 창에서 시작하세요.' }));
    return;
  }
  $('positions').replaceChildren(...account.positions.map((position) => el('div', { class: 'position-row' },
    el('div', {},
      el('span', { class: `side-tag ${position.side}`, text: position.side === 'long' ? '매수 보유' : '매도 보유' }),
      el('strong', { text: ` ${position.symbol} ${position.qty}` }),
      el('p', { class: 'muted small', text: `평균 진입가 ${position.averagePrice}` }),
    ),
    el('div', { class: 'position-right' },
      el('strong', { class: 'pnl', 'data-pnl': position.symbol, 'data-sign': String(Math.sign(position.unrealizedPnlCents)), text: formatSignedCents(position.unrealizedPnlCents) }),
      el('button', { class: 'ghost-btn small', type: 'button', text: '지금 정리하기', disabled: account.status !== 'active', onclick: (event) => closePosition(position.symbol, event.currentTarget) }),
    ),
  )));
}

function renderOrders() {
  const { account } = state.current;
  const key = account.openOrders.map((order) => order.orderId).join(',');
  if (key === state.rendered.orders) return;
  state.rendered.orders = key;
  if (account.openOrders.length === 0) {
    $('open-orders').replaceChildren(el('p', { class: 'muted small', text: '대기 중인 주문이 없습니다.' }));
    return;
  }
  const kind = (order) => {
    if (order.reduceOnly && order.orderType === 'stop') return '손절';
    if (order.reduceOnly && order.orderType === 'limit') return '익절';
    return { limit: '지정가', stop: '스톱', market: '시장가' }[order.orderType];
  };
  $('open-orders').replaceChildren(...account.openOrders.map((order) => el('div', { class: 'order-row' },
    el('span', { class: 'order-kind', text: kind(order) }),
    el('span', { text: `${order.symbol} ${order.side === 'buy' ? '매수' : '매도'} ${order.qty} @ ${order.price ?? '시장가'}` }),
    el('button', { class: 'ghost-btn small', type: 'button', text: '취소', onclick: (event) => cancelOrder(order.orderId, event.currentTarget) }),
  )));
}

// ---- verdict card and appeals -------------------------------------------------------

async function loadAppeals(id) {
  const result = await api.getAppeals(id);
  if (state.current?.account.id !== id) return;
  state.appeals = result.ok ? result.appeals : [];
  renderVerdictCard();
}

function renderVerdictCard() {
  if (!state.current) return;
  const verdict = adverseVerdict(state.current.events);
  const card = $('verdict-card');
  card.hidden = !verdict;
  if (!verdict) return;
  const { title, facts } = verdictFacts(verdict, state.current.phase?.rules ?? []);
  $('verdict-title').textContent = title;
  $('verdict-facts').replaceChildren(...facts.flatMap((fact) => [el('dt', { text: fact.label }), el('dd', { text: fact.value })]));
  const appeal = state.appeals.find((item) => item.eventSeq === verdict.seq);
  const status = appealStatus(appeal);
  $('appeal-status').hidden = !status;
  if (status) {
    $('appeal-status').textContent = status.text;
    $('appeal-status').dataset.tone = status.tone;
  }
  $('appeal-form').hidden = Boolean(appeal);
  $('appeal-form').dataset.seq = String(verdict.seq);
}

async function submitAppeal(event) {
  event.preventDefault();
  const reason = $('appeal-reason').value;
  if (!appealReasonOk(reason)) return void ($('appeal-error').textContent = '사유를 10자 이상 2000자 이하로 적어 주세요.');
  const id = state.current.account.id;
  const result = await api.createAppeal(id, Number($('appeal-form').dataset.seq), reason.trim());
  if (!result.ok) return void ($('appeal-error').textContent = result.message);
  $('appeal-error').textContent = '';
  $('appeal-reason').value = '';
  state.appeals = [...state.appeals, result.appeal];
  renderVerdictCard();
  toast('이의 제기를 접수했습니다.');
}

function renderActivity() {
  const lastSeq = state.current.events.at(-1)?.seq ?? 0;
  if (lastSeq === state.rendered.activity) return;
  state.rendered.activity = lastSeq;
  renderVerdictCard();
  renderReview();
  const verdicts = state.current.events.filter((event) => event.type === 'verdict');
  $('verdicts').replaceChildren(...(verdicts.length ? verdicts.map((event) => el('article', { class: `verdict ${event.verdict}` },
    el('strong', { text: describeEvent(event) }),
    el('p', { class: 'muted small', text: `${event.ruleId ? `규칙 ${event.ruleId} · ` : ''}${formatTimestamp(event.ts)} · 근거 기록 #${event.seq}` }),
  )) : [el('p', { class: 'muted small', text: '아직 판정이 없습니다. 규칙을 어기거나 목표를 달성하면 여기에 남습니다.' })]));
  const events = state.current.events.slice(-LOG_LIMIT).reverse();
  $('activity').replaceChildren(...events.map((event) => el('li', {},
    el('span', { class: 'seq', text: `#${event.seq}` }),
    el('span', { text: describeEvent(event) }),
    el('time', { text: formatTimestamp(event.ts) }),
  )));
}

const REVIEW_TRADE_LIMIT = 50;

function centsText(cents, signed = false) {
  if (cents === null) return '계산 불가';
  return signed ? formatSignedCents(cents) : formatCents(cents);
}

function renderReview() {
  const review = tradeReview(state.current.events);
  const trade = (item) => (item ? `${centsText(item.pnlCents, true)} · ${item.symbol} · 기록 #${item.seq}` : '없음');
  const facts = [
    ['누적 확정 손익', centsText(review.netPnlCents, true)],
    ['낸 수수료', centsText(review.feesCents)],
    ['닫은 거래', `${review.closedTrades}건 (이익 ${review.wins} · 손실 ${review.losses} · 본전 ${review.flat})`],
    ['승률', formatWinRate(review.winRateTenths)],
    ['최대 잔고 하락액', centsText(review.maxDrawdownCents)],
    ['가장 큰 이익', trade(review.best)],
    ['가장 큰 손실', trade(review.worst)],
    ['처음 규칙 위반', review.firstBreach ? `${review.firstBreach.ruleId ? `규칙 ${review.firstBreach.ruleId} · ` : ''}${formatTimestamp(review.firstBreach.ts)} · 기록 #${review.firstBreach.seq}` : '없음'],
  ];
  $('review-facts').replaceChildren(...facts.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', { text: value })]));
  const recent = review.trades.slice(-REVIEW_TRADE_LIMIT).reverse();
  $('review-trades').replaceChildren(...(recent.length ? recent.map((item) => el('li', {},
    el('span', { class: 'seq', text: `#${item.seq}` }),
    el('span', { text: `${item.symbol} ${item.side === 'buy' ? '매수' : '매도'} ${item.qty} @ ${item.price} · ${centsText(item.pnlCents, true)} · 잔고 ${centsText(item.balanceCents)}` }),
    el('time', { text: formatTimestamp(item.ts) }),
  )) : [el('li', { class: 'muted small', text: '아직 닫은 거래가 없습니다. 포지션을 정리하면 결과가 여기에 쌓입니다.' })]));
}

function renderRuleDetail() {
  const { spec, phase } = state.current;
  $('rule-detail').replaceChildren(...phase.rules.map((rule) => {
    const { title, detail } = describeRule(rule, spec.initialBalanceCents);
    return el('li', {}, el('strong', { text: title }), el('span', { text: detail }));
  }));
}

// ---- order ticket -----------------------------------------------------------------

function renderInstruments() {
  $('order-symbol').replaceChildren(...state.current.spec.instruments.map((item) => el('option', { value: item.symbol, text: item.symbol })));
  renderQtyPresets();
}

const currentInstrument = () => state.current?.spec.instruments.find((item) => item.symbol === $('order-symbol').value);
const currentSide = () => document.querySelector('input[name="side"]:checked').value;

function renderQtyPresets() {
  const instrument = currentInstrument();
  if (!instrument) return;
  // Three sizes: one, five and ten "small lots" at the instrument's precision.
  const unit = 10 ** Math.max(0, instrument.qtyDecimals - 2);
  const presets = [1, 5, 10].map((n) => (n * unit / 10 ** instrument.qtyDecimals).toFixed(instrument.qtyDecimals));
  $('qty-presets').replaceChildren(...presets.map((value) => el('button', {
    class: 'preset', type: 'button', text: value,
    onclick: () => {
      $('order-qty').value = value;
      renderTicket();
    },
  })));
}

function renderQuoteLine() {
  if (!state.current) return;
  const quote = state.quotes.get($('order-symbol').value);
  $('order-quote').textContent = quote?.status === 'ok' ? `지금 사면 ${quote.ask} · 지금 팔면 ${quote.bid}` : '시세가 없거나 지연 중이라 주문할 수 없습니다.';
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

function renderTicket() {
  if (!state.current) return;
  $('order-price-wrap').hidden = $('order-type').value === 'market';
  const body = orderBody();
  const buy = body.side === 'buy';
  const submit = $('order-submit');
  submit.textContent = buy ? '매수 주문' : '매도 주문';
  submit.classList.toggle('buy', buy);
  submit.classList.toggle('sell', !buy);

  const quote = state.quotes.get(body.symbol);
  const entryPrice = body.type === 'market' ? (buy ? quote?.ask : quote?.bid) : body.price;
  const notional = orderNotional({ instrument: currentInstrument(), qty: body.qty, price: entryPrice });
  $('order-notional').textContent = notional == null ? '' : `주문 금액 약 ${formatCents(notional)}`;

  const daily = limitCards(state.current.phase.rules, state.current.account.rules, state.current.spec.initialBalanceCents).find((card) => card.kind === 'daily_loss');
  const preview = stopLossPreview({ instrument: currentInstrument(), side: body.side, qty: body.qty, entryPrice, stopLoss: body.stopLoss, dailyRemainingCents: daily?.remainingCents });
  const node = $('order-preview');
  if (!body.qty) {
    node.textContent = '';
    return;
  }
  if (!preview.available) {
    node.textContent = body.stopLoss ? preview.reason : '손절가가 없으면 손실이 어디까지 커질지 정해지지 않습니다. 손절가를 넣는 것을 권합니다.';
    node.dataset.tone = body.stopLoss ? 'normal' : 'caution';
    return;
  }
  const after = preview.remainingAfterCents == null ? ''
    : preview.reachesLimit ? ' 이 손실이면 하루 손실 한도에 닿습니다.' : ` 그래도 하루 한도는 ${formatCents(preview.remainingAfterCents)} 남습니다.`;
  node.textContent = `손절되면 약 ${formatCents(preview.lossCents)} 잃습니다(수수료 포함).${after} 가격이 급하게 건너뛰면 손실이 더 클 수 있습니다.`;
  node.dataset.tone = preview.reachesLimit ? 'danger' : 'normal';
}

async function submitOrder(event) {
  event.preventDefault();
  const body = orderBody();
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
  message.textContent = result.replayed ? '이미 접수된 주문입니다.' : '주문이 접수됐습니다.';
  message.dataset.tone = 'success';
  for (const id of ['order-qty', 'order-price', 'order-sl', 'order-tp']) $(id).value = '';
  applyCommandResult(result);
}

function applyCommandResult(result) {
  if (!state.current || !result.snapshot) return;
  state.current.account = { ...state.current.account, ...result.snapshot };
  renderDashboard();
  updateAccountItem(state.current.account);
  if (result.promotedAccountId) refreshAccounts();
}

async function cancelOrder(orderId, button) {
  button.disabled = true;
  const result = await api.cancelOrder(state.current.account.id, orderId);
  if (!result.ok) {
    button.disabled = false;
    toast(result.message, 'warning');
    return;
  }
  applyCommandResult(result);
}

async function closePosition(symbol, button) {
  button.disabled = true;
  const result = await api.closePosition(state.current.account.id, symbol);
  if (!result.ok) {
    button.disabled = false;
    toast(result.message, 'warning');
    return;
  }
  toast('포지션을 정리했습니다.');
  applyCommandResult(result);
}

// ---- boot ------------------------------------------------------------------------

async function boot() {
  mountThemeToggle($('theme-slot'));
  globalThis.addEventListener('omp:themechange', () => renderChart());
  $('auth-form').addEventListener('submit', submitAuth);
  $('auth-toggle').addEventListener('click', () => {
    state.registerMode = !state.registerMode;
    renderShell();
  });
  $('logout').addEventListener('click', doLogout);
  $('new-account').addEventListener('click', showCatalog);
  $('guide-close').addEventListener('click', () => {
    localStorage.setItem(GUIDE_KEY, '1');
    $('guide').hidden = true;
  });
  $('order-form').addEventListener('submit', submitOrder);
  $('security-open').addEventListener('click', showSecurity);
  $('mfa-start').addEventListener('click', startMfa);
  $('mfa-form').addEventListener('submit', submitMfa);
  $('mfa-disable').addEventListener('click', disableMfa);
  $('appeal-form').addEventListener('submit', submitAppeal);
  $('order-form').addEventListener('input', renderTicket);
  $('order-form').addEventListener('change', (event) => {
    if (event.target.id === 'order-symbol') {
      renderMarket();
      loadCandles();
      renderQtyPresets();
    }
    renderQuoteLine();
    renderTicket();
  });

  const me = await api.getMe();
  if (me.code === 'offline') {
    $('welcome').hidden = false;
    toast('서버에 연결할 수 없습니다. 이 화면은 백엔드를 실행했을 때만 동작합니다.', 'warning');
    return;
  }
  state.user = me.ok ? me.user : null;
  renderShell();
  if (state.user) await loadWorkspace();
}

boot();
