// Display logic for the paid-evaluation purchase flow: won amounts, order status
// wording, what the payment step may offer, and when a 청약 철회 is still possible.
// No DOM here, so it can be tested under node.
//
// The one rule this module exists to enforce (제품 명세 §2.3): a payment counts as
// finished only when the server hands back the account it opened in the same
// transaction. Anything else is "확인 중" or "취소됨" — never "결제 완료".

import { formatKrw } from './format.js';
import { PAID_NOTICE } from '../site/view.js';

const SLOT_PREFIX = 'oh-my-prop.checkout.';
const KEY_SHAPE = /^[A-Za-z0-9_-]{8,64}$/; // backend/src/money/payments.js:27

export const CHECKING_TEXT = '결제가 취소됐는지 확인 중입니다. 결과가 나올 때까지 다시 결제하지 마세요.';
export const NO_PAYMENT_METHOD = '결제 수단 연결 전 — 결제 창을 띄울 수 없습니다. 주문서만 만들어진 상태입니다.';
export const DEV_PAY_NOTICE = '개발 환경 모의 결제입니다. 실제 결제 수단이 아니고 돈이 움직이지 않습니다.';
export const FEATURE_OFF_TEXT = PAID_NOTICE; // 홈·규칙 화면과 같은 문구를 쓴다.

// Order states of backend/src/money/payments.js:6-11. `pending` means the outcome is
// still moving on the server, so the screen keeps polling instead of concluding.
const STATUS = {
  created: { label: '결제 대기', tone: 'info', help: '주문서만 만들어졌습니다. 아직 결제되지 않았습니다.' },
  confirming: { label: '결제 확인 중', tone: 'wait', pending: true, help: CHECKING_TEXT },
  unknown: { label: '결제 확인 중', tone: 'wait', pending: true, help: CHECKING_TEXT },
  paid: { label: '결제 완료', tone: 'ok', help: '결제와 함께 거래 계정이 열렸습니다.' },
  failed: { label: '결제 취소됨', tone: 'bad', help: '결제가 승인되지 않았습니다. 청구되지 않습니다.' },
  void_pending: { label: '결제 취소 중', tone: 'wait', pending: true, help: '계정을 열 수 없어 결제를 취소하는 중입니다.' },
  voided: { label: '결제 취소됨', tone: 'bad', help: '계정을 열 수 없어 결제가 취소됐습니다.' },
  refund_pending: { label: '청약 철회 처리 중', tone: 'wait', pending: true, help: '철회 요청을 접수했습니다. 처리되면 계정이 닫힙니다.' },
  refunded: { label: '청약 철회 완료', tone: 'bad', help: '결제가 철회되고 계정이 닫혔습니다.' },
};

export function orderStatusView(status) {
  return STATUS[status] ?? { label: String(status ?? '알 수 없음'), tone: 'info', help: '' };
}

// A paid order whose account is still unused can be withdrawn. `tradingDays > 0`
// means a fill happened (backend/src/rules/engine.js:150); the server decides for
// real (refund_not_allowed), this only keeps the button away when we already know.
export function refundState(order, account) {
  if (!order || order.status !== 'paid') return { can: false, reason: null };
  if (!account) return { can: false, reason: '계정을 불러오는 중입니다.' };
  if (account.status === 'withdrawn') return { can: false, reason: '이미 닫힌 계정입니다.' };
  if (account.status !== 'active') return { can: false, reason: '이미 종료된 계정은 철회 대상이 아닙니다.' };
  if ((account.tradingDays ?? 0) > 0 || (account.positions?.length ?? 0) > 0) {
    return { can: false, reason: '이미 거래를 시작한 계정은 철회 대상이 아닙니다.' };
  }
  return { can: true, reason: null };
}

// 결제됐는데 계정이 없으면 계정 칸을 비워 둔다. 발급됐다고 읽히면 안 된다(제품 명세 §2.3).
function accountLabel(order) {
  if (!order.accountId) return '—';
  if (order.status === 'refunded') return `계정 #${order.accountId} · 닫힘`;
  return `계정 #${order.accountId}`;
}

export function orderRow(order, accountsById = new Map()) {
  const view = orderStatusView(order.status);
  const account = order.accountId == null ? null : accountsById.get(order.accountId) ?? null;
  return {
    orderId: order.orderId,
    status: order.status,
    label: view.label,
    tone: view.tone,
    help: view.help,
    pending: Boolean(view.pending),
    amountText: formatKrw(order.amountKrw),
    accountId: order.accountId ?? null,
    accountText: accountLabel(order),
    refund: refundState(order, account),
  };
}

export const hasPendingOrder = (orders) => orders.some((order) => orderStatusView(order.status).pending);

/**
 * What the payment step may show. `devTools` is null while we have not probed yet.
 * Without the dev tools there is no payment widget to open, and we say exactly that
 * instead of drawing a fake one.
 */
export function payStep(order, devTools) {
  if (!order) return { kind: 'none', text: '' };
  const view = orderStatusView(order.status);
  if (order.status === 'paid') {
    return order.accountId
      ? { kind: 'opened', text: view.help, accountId: order.accountId }
      : { kind: 'checking', text: CHECKING_TEXT };
  }
  if (view.pending) return { kind: 'checking', text: view.help };
  if (order.status !== 'created') return { kind: 'stopped', text: view.help };
  if (devTools === null) return { kind: 'probing', text: '결제 수단을 확인하는 중입니다.' };
  return devTools
    ? { kind: 'mock', text: DEV_PAY_NOTICE }
    : { kind: 'unavailable', text: NO_PAYMENT_METHOD };
}

/**
 * Read a confirm (or order poll) response. "결제됨"만으로는 부족하다: 서버가 같은
 * 트랜잭션에서 연 계정 id가 있어야 발급으로 본다.
 */
export function confirmOutcome(result) {
  if (result.ok) {
    if (result.status === 'paid' && result.accountId) {
      return { kind: 'opened', accountId: result.accountId, text: '결제가 끝나고 거래 계정이 열렸습니다.' };
    }
    if (result.status === 'refunded') return { kind: 'refunded', text: '청약 철회가 끝났습니다. 결제가 취소되고 계정이 닫혔습니다.' };
    if (result.status === 'refund_pending') return { kind: 'waiting', text: STATUS.refund_pending.help };
    if (result.status === 'failed') return { kind: 'canceled', text: '결제가 취소됐습니다. 승인되지 않아 청구되지 않습니다.' };
    if (result.status === 'voided') return { kind: 'canceled', text: '계정을 열 수 없어 결제가 취소됐습니다.' };
    return { kind: 'checking', text: CHECKING_TEXT };
  }
  const order = result.order ?? null;
  if (result.code === 'payment_failed' || order?.status === 'failed') {
    // 사유는 주문의 failureCode로 따로 보여 준다. 결제사 원문은 화면 문구로 쓰지 않는다.
    return { kind: 'canceled', text: '결제가 취소됐습니다. 승인되지 않아 청구되지 않습니다.' };
  }
  // 응답을 못 받았거나 서버가 5xx면 청구 여부를 알 수 없다. 실패라고 말하지 않는다.
  if (result.code === 'offline' || !result.status || result.status >= 500) {
    return { kind: 'checking', text: CHECKING_TEXT };
  }
  if (result.code === 'feature_disabled') return { kind: 'disabled', text: FEATURE_OFF_TEXT };
  return { kind: 'error', text: result.message };
}

// ---- idempotency key ---------------------------------------------------------------

// One slot per product in session storage: the idempotency key and, once we know it,
// the order it created. The key is made once and reused on every retry — including a
// page reload — so a resend can never create a second order or a second charge. The
// order id is what lets a reloaded screen resume the right order (the server's order
// view does not say which product it belongs to).
export function purchaseSlot(store, productKey) {
  const raw = store.getItem(SLOT_PREFIX + productKey);
  if (!raw) return null;
  try {
    const slot = JSON.parse(raw);
    if (slot && KEY_SHAPE.test(slot.key ?? '')) return { key: slot.key, orderId: slot.orderId ?? null };
  } catch {
    // 손상된 값은 없는 것으로 본다. 키를 새로 만들어도 결제는 사용자가 다시 눌러야 일어난다.
  }
  return null;
}

export function startPurchase(store, productKey, make) {
  const slot = purchaseSlot(store, productKey);
  if (slot) return slot.key;
  const key = make();
  store.setItem(SLOT_PREFIX + productKey, JSON.stringify({ key, orderId: null }));
  return key;
}

export function rememberOrder(store, productKey, orderId) {
  const slot = purchaseSlot(store, productKey);
  if (slot) store.setItem(SLOT_PREFIX + productKey, JSON.stringify({ key: slot.key, orderId }));
}

export function endPurchase(store, productKey) {
  store.removeItem(SLOT_PREFIX + productKey);
}
