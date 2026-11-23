// Purchase screen for paid evaluations (제품 명세 §2.3): 상품 비교 → 규칙 전문·환불
// 정책 확인 → 결제 → 계정 발급. DOM is built with createElement/textContent only and
// without inline styles, because the CSP forbids both.
//
// Three things this file is careful about:
//  1. "결제 완료"는 서버가 같은 트랜잭션에서 연 계정 id를 돌려줬을 때만 말한다.
//     답을 못 받았으면 "확인 중"이고, 거절이 확인됐을 때만 "취소됨"이다.
//  2. 주문 생성의 Idempotency-Key는 상품마다 한 번 만들어 세션 저장소에 두고,
//     재전송·새로고침에도 같은 키를 보낸다(중복 주문·중복 결제 방지).
//  3. 실제 PG 위젯은 없다. 개발 도구가 켜진 서버에서만 모의 결제를 제공하고,
//     그렇지 않으면 "결제 수단 연결 전"이라고 분명히 적는다.

import * as api from './api.js';
import { el } from '../site/dom.js';
import { rulesDocument } from '../site/view.js';
import { programName } from './view.js';
import {
  FEATURE_OFF_TEXT, confirmOutcome, endPurchase, formatKrw, hasPendingOrder,
  orderRow, orderStatusView, payStep, purchaseSlot, rememberOrder, startPurchase,
} from './checkout-view.js';
import { ensureIdentity, identityGateNow, openIdentity, refreshIdentity } from './identity.js';
import { identityBlock } from './identity-view.js';

const $ = (id) => document.getElementById(id);
const POLL_MS = 2000;
const POLL_LIMIT = 30; // 1분이면 릴레이·대사가 끝난다. 그 뒤에는 주문 내역에서 확인하도록 안내한다.

const REFUND_POLICY = [
  '거래를 시작하기 전까지만 청약 철회(환불)할 수 있습니다.',
  '철회하면 결제가 취소되고 그 거래 계정은 닫힙니다. 되돌릴 수 없습니다.',
  '한 번이라도 체결이 있었다면 철회 대상이 아닙니다.',
];

const state = {
  program: null, // 선택한 상품 요약(/api/v2/programs 항목)
  doc: null, // rulesDocument(spec) — 규칙 전문과 버전 해시
  order: null, // 지금 진행 중인 주문
  orders: [],
  accounts: new Map(),
  devTools: null, // null이면 아직 확인 전
  enabled: null, // null 확인 전, false면 기능 플래그 꺼짐
  accepted: { rules: false, refund: false },
  busy: false,
  message: null, // { tone, text }
  refundAsk: null, // 철회 확인을 기다리는 주문 id
  identityAsk: null, // 본인확인 때문에 막혔을 때 띄우는 안내와 버튼
  poll: null,
  polls: 0,
};

let hooks = { closeOthers: () => {}, openAccount: () => {}, accountsChanged: () => {}, accounts: () => [], showCatalog: () => {} };

export function initCheckout(options) {
  hooks = { ...hooks, ...options };
}

export function closeCheckout() {
  stopPoll();
  $('checkout').hidden = true;
}

const productKey = (program) => `${program.program}@${program.version}`;
const orderOf = (payload) => ({
  orderId: payload.orderId,
  status: payload.status,
  amountKrw: payload.amountKrw,
  accountId: payload.accountId ?? null,
  failureCode: payload.failureCode ?? null,
  createdAt: payload.createdAt ?? null,
});

function syncAccounts() {
  state.accounts = new Map(hooks.accounts().map((account) => [account.id, account]));
}

// 계정 목록이 바뀌면 주문 행의 "철회 가능" 여부와 계정 번호도 함께 바뀐다.
export function accountsSynced() {
  if ($('checkout').hidden) return;
  syncAccounts();
  render();
}

/** Open the purchase view. `program`/`spec` are null when only the order list is wanted. */
export async function openCheckout(program, spec) {
  hooks.closeOthers();
  $('checkout').hidden = false;
  state.program = program ?? null;
  state.doc = spec ? rulesDocument(spec) : null;
  state.accepted = { rules: false, refund: false };
  state.message = null;
  state.identityAsk = null;
  state.refundAsk = null;
  state.order = null;
  syncAccounts();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await refresh();
}

async function refresh() {
  const [orders, devTools] = await Promise.all([
    api.listOrders(),
    state.devTools === null ? api.devToolsAvailable() : Promise.resolve(state.devTools),
    ensureIdentity(), // 기능이 없는 서버에서는 조용히 '없음'으로 끝난다
  ]);
  state.devTools = devTools;
  if (orders.ok) {
    state.enabled = true;
    state.orders = orders.orders.map(orderOf);
    // 보고 있는 상품에 진행 중이던 주문이 있으면 그 결제 단계를 이어서 보여 준다.
    const slot = state.program ? purchaseSlot(sessionStorage, productKey(state.program)) : null;
    const resumed = slot?.orderId ? state.orders.find((order) => order.orderId === slot.orderId) : null;
    if (state.order) state.order = state.orders.find((order) => order.orderId === state.order.orderId) ?? state.order;
    else if (resumed && (resumed.status === 'created' || orderStatusView(resumed.status).pending)) state.order = resumed;
    else if (resumed) endPurchase(sessionStorage, productKey(state.program));
  } else if (orders.code === 'feature_disabled') {
    state.enabled = false;
  } else if (orders.code !== 'unauthorized') {
    state.message = { tone: 'warning', text: orders.message };
  }
  syncAccounts();
  render();
  schedulePoll();
}

// ---- polling -------------------------------------------------------------------------

function stopPoll() {
  clearTimeout(state.poll);
  state.poll = null;
  state.polls = 0;
}

function schedulePoll() {
  if (state.poll) return;
  const pending = hasPendingOrder(state.orders) || (state.order ? orderStatusView(state.order.status).pending : false);
  if (!pending) return;
  state.poll = setTimeout(pollOnce, POLL_MS);
}

async function pollOnce() {
  state.poll = null;
  state.polls += 1;
  const result = await api.listOrders();
  if (result.ok) {
    const previous = state.order;
    const before = new Map(state.orders.map((order) => [order.orderId, order.status]));
    state.orders = result.orders.map(orderOf);
    const updated = previous ? state.orders.find((order) => order.orderId === previous.orderId) : null;
    if (updated) {
      state.order = updated;
      if (updated.status !== previous.status) applyOutcome({ ok: true, ...updated });
    }
    // 결제 단계에 없는 주문(목록에서 바로 철회한 주문 등)도 끝나면 결과를 알린다.
    for (const order of state.orders) {
      if (order.orderId === state.order?.orderId) continue;
      const was = before.get(order.orderId);
      if (was && was !== order.status) state.message = { tone: 'warning', text: confirmOutcome({ ok: true, ...order }).text };
    }
    if (state.orders.some((order) => order.status === 'refunded' || order.status === 'paid')) hooks.accountsChanged();
  }
  syncAccounts();
  render();
  if (state.polls >= POLL_LIMIT) {
    state.message = { tone: 'warning', text: '아직 처리 중입니다. 잠시 후 주문 내역에서 결과를 확인해 주세요.' };
    stopPoll();
    render();
    return;
  }
  schedulePoll();
}

// ---- actions ---------------------------------------------------------------------------

async function createOrder() {
  if (!state.program || state.busy) return;
  state.busy = true;
  state.message = null;
  state.identityAsk = null;
  render();
  const key = startPurchase(sessionStorage, productKey(state.program), api.newKey);
  const result = await api.createOrder(state.program.program, state.program.version, state.program.rulesSha256, key);
  state.busy = false;
  if (!result.ok) {
    const block = identityBlock(result);
    if (result.code === 'feature_disabled') state.enabled = false;
    else if (block) {
      // 본인확인 게이트다(403). 오류 문구만 띄우지 않고 그 화면으로 가는 버튼까지 둔다.
      // 우리 쪽 상태가 낡아서 막힌 것이므로 서버 상태를 다시 읽는다.
      state.identityAsk = block;
      state.message = { tone: 'warning', text: block.text };
      await refreshIdentity();
    } else state.message = { tone: 'warning', text: result.message };
    render();
    return;
  }
  state.order = orderOf(result);
  rememberOrder(sessionStorage, productKey(state.program), state.order.orderId);
  state.orders = [state.order, ...state.orders.filter((order) => order.orderId !== state.order.orderId)];
  render();
  $('checkout-pay').focus();
}

async function payNow() {
  if (!state.order || state.busy) return;
  state.busy = true;
  state.message = null;
  render();
  const started = await api.devMockPay(state.order.orderId);
  if (!started.ok) {
    state.busy = false;
    // 개발 도구가 없는 서버다(또는 꺼졌다). 가짜 결제 화면을 남겨 두지 않는다.
    if (started.status === 404) state.devTools = false;
    else state.message = { tone: 'warning', text: started.message };
    render();
    return;
  }
  const result = await api.confirmOrder(state.order.orderId, started.paymentKey, started.amountKrw);
  state.busy = false;
  applyOutcome(result);
  render();
  schedulePoll();
}

function applyOutcome(result) {
  const outcome = confirmOutcome(result);
  const payload = result.ok && result.orderId ? result : result.order;
  if (payload?.orderId) {
    state.order = orderOf(payload);
    state.orders = state.orders.map((order) => (order.orderId === state.order.orderId ? state.order : order));
  }
  // 주문이 'created'를 벗어나면 그 키의 역할은 끝났다. 다음 구매는 새 키로 시작한다.
  if (state.program && state.order && state.order.status !== 'created') endPurchase(sessionStorage, productKey(state.program));
  const tone = {
    opened: 'success', checking: 'warning', waiting: 'warning', refunded: 'warning',
    canceled: 'danger', disabled: 'warning', error: 'danger',
  }[outcome.kind] ?? 'warning';
  state.message = { tone, text: outcome.text };
  if (outcome.kind === 'disabled') state.enabled = false;
  if (outcome.kind === 'opened' || outcome.kind === 'refunded') hooks.accountsChanged();
}

async function submitRefund(orderId) {
  if (state.busy) return;
  state.busy = true;
  state.refundAsk = null;
  state.message = null;
  render();
  const result = await api.refundOrder(orderId);
  state.busy = false;
  if (!result.ok) {
    state.message = { tone: 'warning', text: result.message };
    render();
    return;
  }
  const updated = orderOf(result);
  state.orders = state.orders.map((order) => (order.orderId === orderId ? updated : order));
  if (state.order?.orderId === orderId) state.order = updated;
  state.message = { tone: 'warning', text: '청약 철회를 접수했습니다. 처리가 끝나면 계정이 닫힙니다.' };
  render();
  schedulePoll();
}

// ---- rendering -------------------------------------------------------------------------

function render() {
  // 안내에 "다음에 할 일" 버튼이 붙을 수 있다(본인확인으로 보내기).
  const message = $('checkout-message');
  const parts = [];
  if (state.message) parts.push(el('span', { text: state.message.text }));
  if (state.identityAsk) {
    parts.push(el('button', { class: 'ghost-btn small', type: 'button', text: state.identityAsk.action, onclick: goIdentity }));
  }
  message.replaceChildren(...parts);
  message.dataset.tone = state.message?.tone ?? '';
  message.hidden = parts.length === 0;

  if (state.enabled === false) {
    $('checkout-product').replaceChildren(el('section', { class: 'panel soon-panel' },
      el('p', { class: 'soon', text: FEATURE_OFF_TEXT }),
      el('p', { class: 'muted small', text: '무료 시즌 챌린지는 지금도 열 수 있습니다. 왼쪽 목록에서 새 계정을 선택하세요.' }),
    ));
    $('checkout-pay').hidden = true;
    $('checkout-orders-panel').hidden = true;
    return;
  }
  $('checkout-orders-panel').hidden = false;
  renderProduct();
  renderPay();
  renderOrders();
}

function renderProduct() {
  const host = $('checkout-product');
  if (!state.program || !state.doc) {
    host.replaceChildren(el('section', { class: 'panel' },
      el('p', { class: 'muted', text: '구매할 상품은 상품 목록에서 고릅니다.' }),
      el('button', { class: 'ghost-btn', type: 'button', text: '상품 목록 보기', onclick: () => hooks.showCatalog?.() }),
    ));
    return;
  }
  const doc = state.doc;
  const gate = identityGateNow();
  const rules = el('details', { class: 'rules-more' },
    el('summary', { text: '규칙 전문 보기' }),
    ...doc.phases.map((phase) => el('div', { class: 'phase-block' },
      el('p', { class: 'phase-name', text: `${phase.label} 단계` }),
      el('ul', { class: 'rule-list' }, phase.rules.map((rule) => el('li', {},
        el('strong', { text: rule.title }),
        rule.detail ? el('span', { text: rule.detail }) : null,
      ))),
    )),
  );
  const accept = (name, label, help) => {
    const box = el('input', { type: 'checkbox', id: `accept-${name}` });
    box.checked = state.accepted[name];
    box.addEventListener('change', () => {
      state.accepted[name] = box.checked;
      $('buy-start').disabled = !canBuy();
    });
    return el('div', { class: 'accept-row' },
      el('label', { class: 'accept', for: box.id }, box, el('span', { text: label })),
      help ? el('p', { class: 'field-help', text: help }) : null,
    );
  };
  const start = el('button', { class: 'primary-btn', id: 'buy-start', type: 'button', text: '주문서 만들기 — 결제 금액 확인', onclick: createOrder });
  start.disabled = !canBuy();

  host.replaceChildren(el('section', { class: 'panel buy-panel', 'aria-labelledby': 'buy-title' },
    el('div', { class: 'program-top' },
      el('span', { class: 'tag paid', text: '유료 평가' }),
      el('span', { class: 'muted small', text: `규칙 버전 v${doc.version}` }),
    ),
    el('h2', { id: 'buy-title', text: programName(doc.code) }),
    el('p', { class: 'balance', text: doc.balanceText }),
    doc.description ? el('p', { class: 'muted', text: doc.description }) : null,
    el('dl', { class: 'facts' },
      el('dt', { text: '상품 코드' }), el('dd', {}, el('code', { text: doc.code })),
      el('dt', { text: '규칙 버전 해시(SHA-256)' }), el('dd', {}, el('code', { class: 'sha', title: doc.sha, text: doc.shortSha })),
      el('dt', { text: '결제 금액' }), el('dd', { text: '주문서를 만들면 확정 금액(원화)을 보여 줍니다.' }),
    ),
    rules,
    el('a', { class: 'link-btn', href: `/rules.html?program=${encodeURIComponent(doc.code)}&version=${doc.version}`, text: '규칙 설명 페이지 열기' }),
    el('div', { class: 'policy' },
      el('h3', { text: '청약 철회(환불) 정책' }),
      el('ul', { class: 'rule-list' }, REFUND_POLICY.map((line) => el('li', {}, el('span', { text: line })))),
    ),
    state.order || gate.blocks ? null : accept('rules', '규칙 전문과 규칙 버전 해시를 확인했고 동의합니다'),
    state.order || gate.blocks ? null : accept('refund', '청약 철회 조건을 확인했습니다', '거래를 시작하면 철회할 수 없습니다.'),
    gate.blocks ? identityStep() : null,
    state.order ? el('p', { class: 'soon', text: '이 상품의 주문이 이미 있습니다. 아래 결제 단계에서 이어서 진행하세요.' }) : (gate.blocks ? null : start),
    gate.kind === 'done' ? el('p', { class: 'muted small', text: '본인확인을 마친 계정입니다. 구매를 바로 진행할 수 있습니다.' }) : null,
    state.busy ? el('p', { class: 'muted small', text: '처리 중…' }) : null,
  ));
}

// 결제 앞단계. 서버가 주문 생성 자체를 막으므로(identity.js:94-98) 주문서 버튼
// 대신 이 칸을 둔다. "무엇을 해야 하는지"가 버튼까지 이어져야 한다.
function identityStep() {
  return el('div', { class: 'identity-step' },
    el('p', { class: 'identity-step-tag', text: '1단계 · 본인확인' }),
    el('p', { text: '유료 평가는 만 19세 이상 본인확인을 마친 계정만 결제할 수 있습니다. 계정당 한 번만 하면 됩니다.' }),
    el('p', { class: 'muted small', text: '저장하는 것은 연결정보(CI)의 해시뿐이고, 이름·생년월일 원문은 남기지 않습니다.' }),
    el('button', { class: 'primary-btn', id: 'go-identity', type: 'button', text: '본인확인 하러 가기', onclick: goIdentity }),
  );
}

function goIdentity() {
  stopPoll();
  openIdentity({ resume: resumeCheckout });
}

/** 본인확인 화면에서 돌아왔다. 상품과 동의 상태는 그대로 두고 다시 그린다. */
function resumeCheckout() {
  hooks.closeOthers();
  $('checkout').hidden = false;
  state.message = null;
  state.identityAsk = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  refresh();
}

const canBuy = () => state.accepted.rules && state.accepted.refund && !state.busy && !state.order;

function renderPay() {
  const panel = $('checkout-pay');
  const step = payStep(state.order, state.devTools);
  if (step.kind === 'none') {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const order = state.order;
  const view = orderStatusView(order.status);
  const head = el('dl', { class: 'facts' },
    el('dt', { text: '주문 번호' }), el('dd', {}, el('code', { text: order.orderId })),
    el('dt', { text: '결제 금액' }), el('dd', {}, el('strong', { class: 'krw', text: formatKrw(order.amountKrw) })),
    el('dt', { text: '상태' }), el('dd', {}, el('span', { class: 'status-pill', 'data-tone': view.tone, text: view.label })),
  );
  const body = [head, el('p', { class: 'pay-note', 'data-kind': step.kind, text: step.text })];

  // 결제사 원문 메시지 대신 서버가 기록한 사유 코드를 덧붙인다.
  if (order.failureCode && (order.status === 'failed' || order.status === 'voided')) {
    body.push(el('p', { class: 'muted small', text: `사유 코드: ${order.failureCode}` }));
  }
  if (step.kind === 'mock') {
    const button = el('button', { class: 'primary-btn', type: 'button', text: '모의 결제 실행 (개발용)', onclick: payNow });
    button.disabled = state.busy;
    body.push(el('div', { class: 'dev-pay' },
      el('p', { class: 'dev-pay-tag', text: '개발 도구' }),
      el('p', { class: 'muted small', text: '결제 대행사 연결 전이라 서버의 모의 결제로 승인 과정을 대신합니다.' }),
      button,
    ));
  }
  if (step.kind === 'unavailable') {
    body.push(el('p', { class: 'muted small', text: '주문서는 그대로 남아 있습니다. 결제 수단이 연결되면 이어서 결제할 수 있습니다.' }));
  }
  if (step.kind === 'checking') {
    body.push(el('p', { class: 'muted small', text: '결과가 확정되면 이 화면이 바뀝니다. 창을 닫아도 주문 내역에서 확인할 수 있습니다.' }));
  }
  if (step.kind === 'opened') {
    body.push(el('button', {
      class: 'primary-btn',
      type: 'button',
      text: `계정 #${step.accountId} 열기`,
      onclick: () => hooks.openAccount(step.accountId),
    }));
  }
  if (step.kind === 'stopped') {
    body.push(el('button', {
      class: 'ghost-btn',
      type: 'button',
      text: '다른 주문서 만들기',
      onclick: () => { state.order = null; state.accepted = { rules: false, refund: false }; state.message = null; render(); },
    }));
  }
  $('pay-body').replaceChildren(...body);
}

function renderOrders() {
  const host = $('checkout-orders');
  if (state.orders.length === 0) {
    host.replaceChildren(el('p', { class: 'muted small empty', text: '아직 주문이 없습니다.' }));
    return;
  }
  host.replaceChildren(...state.orders.map((order) => {
    const row = orderRow(order, state.accounts);
    const asking = state.refundAsk === row.orderId;
    const actions = [];
    if (row.refund.can && !asking) {
      actions.push(el('button', {
        class: 'ghost-btn small',
        type: 'button',
        text: '청약 철회',
        onclick: () => { state.refundAsk = row.orderId; render(); },
      }));
    } else if (row.status === 'paid' && row.refund.reason) {
      actions.push(el('span', { class: 'muted small', text: row.refund.reason }));
    }
    if (row.status === 'created' && state.order?.orderId !== row.orderId) {
      actions.push(el('button', {
        class: 'ghost-btn small',
        type: 'button',
        text: '결제 이어서 하기',
        onclick: () => {
          state.order = state.orders.find((item) => item.orderId === row.orderId) ?? null;
          state.message = null;
          render();
          $('checkout-pay').focus();
        },
      }));
    }
    const confirmBox = asking
      ? el('div', { class: 'refund-ask', role: 'group', 'aria-label': '청약 철회 확인' },
        el('p', { text: `주문 ${row.orderId}의 결제를 취소하고 계정 #${row.accountId}을 닫습니다. 되돌릴 수 없습니다.` }),
        el('div', { class: 'refund-actions' },
          el('button', { class: 'primary-btn sell', type: 'button', text: '철회 확정', onclick: () => submitRefund(row.orderId) }),
          el('button', { class: 'ghost-btn', type: 'button', text: '그만두기', onclick: () => { state.refundAsk = null; render(); } }),
        ))
      : null;
    return el('article', { class: 'order-card' },
      el('div', { class: 'order-card-top' },
        el('code', { class: 'order-id', text: row.orderId }),
        el('span', { class: 'status-pill', 'data-tone': row.tone, text: row.label }),
      ),
      el('div', { class: 'order-card-body' },
        el('strong', { class: 'krw', text: row.amountText }),
        el('span', { class: 'muted small', text: row.accountText }),
      ),
      el('p', { class: 'muted small', text: row.help }),
      actions.length ? el('div', { class: 'order-actions' }, actions) : null,
      confirmBox,
    );
  }));
}
