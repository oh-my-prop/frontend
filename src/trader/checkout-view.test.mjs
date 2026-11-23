import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKrw } from './format.js';
import {
  confirmOutcome, endPurchase, hasPendingOrder, orderRow, payStep,
  purchaseSlot, refundState, rememberOrder, startPurchase,
} from './checkout-view.js';
const fakeStore = () => {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
};

test('won amounts never look like the virtual USD balance', () => {
  assert.equal(formatKrw(190000), '190,000원');
  assert.equal(formatKrw(0), '0원');
  assert.equal(formatKrw(1500000), '1,500,000원');
});

test('a payment is "완료" only when the server also opened the account', () => {
  const opened = confirmOutcome({ ok: true, status: 'paid', accountId: 12 });
  assert.equal(opened.kind, 'opened');
  assert.equal(opened.accountId, 12);
  // 결제는 됐다는데 계정이 없다 → 발급이라고 말하지 않고 확인 중으로 둔다(제품 명세 §2.3).
  assert.equal(confirmOutcome({ ok: true, status: 'paid', accountId: null }).kind, 'checking');
  assert.equal(payStep({ orderId: 'o1', status: 'paid', accountId: null }, true).kind, 'checking');
  assert.equal(payStep({ orderId: 'o1', status: 'paid', accountId: 9 }, true).kind, 'opened');
});

test('"확인 중"과 "취소됨"을 구분한다', () => {
  assert.equal(confirmOutcome({ ok: true, status: 'unknown' }).kind, 'checking');
  assert.equal(confirmOutcome({ ok: false, code: 'offline', status: 0, message: '서버에 연결할 수 없습니다.' }).kind, 'checking');
  assert.equal(confirmOutcome({ ok: false, code: 'internal', status: 503, message: '서버 오류' }).kind, 'checking');
  const canceled = confirmOutcome({ ok: false, status: 402, code: 'payment_failed', message: 'confirm rejected by provider', order: { orderId: 'o1', status: 'failed' } });
  assert.equal(canceled.kind, 'canceled');
  // 결제사 원문(영문 코드)을 그대로 띄우지 않는다. 사유 코드는 주문 행에서 따로 보여 준다.
  assert.match(canceled.text, /결제가 취소됐습니다\. 승인되지 않아 청구되지 않습니다\./);
  assert.equal(confirmOutcome({ ok: true, status: 'voided' }).kind, 'canceled');
  assert.equal(confirmOutcome({ ok: false, status: 403, code: 'feature_disabled', message: 'x' }).kind, 'disabled');
  assert.equal(confirmOutcome({ ok: false, status: 409, code: 'invalid_state', message: '상태가 paid인 주문은 승인할 수 없습니다.' }).kind, 'error');
  const refunded = confirmOutcome({ ok: true, status: 'refunded', accountId: 7 });
  assert.equal(refunded.kind, 'refunded');
  assert.match(refunded.text, /청약 철회가 끝났습니다/, '철회 결과를 "결제 확인 중"이라고 말하지 않는다');
  assert.equal(confirmOutcome({ ok: true, status: 'refund_pending', accountId: 7 }).kind, 'waiting');
});

test('결제 수단이 없으면 가짜 결제 화면 대신 사실을 말한다', () => {
  const order = { orderId: 'o1', status: 'created', amountKrw: 190000 };
  assert.equal(payStep(order, null).kind, 'probing');
  assert.equal(payStep(order, false).kind, 'unavailable');
  assert.match(payStep(order, false).text, /결제 수단 연결 전/);
  assert.equal(payStep(order, true).kind, 'mock');
  assert.equal(payStep(null, true).kind, 'none');
  assert.equal(payStep({ orderId: 'o1', status: 'failed' }, true).kind, 'stopped');
  assert.equal(payStep({ orderId: 'o1', status: 'refund_pending' }, true).kind, 'checking');
});

test('청약 철회는 거래 전의 열린 계정에서만 제안된다', () => {
  const paid = { orderId: 'o1', status: 'paid', accountId: 7, amountKrw: 190000 };
  const fresh = { id: 7, status: 'active', tradingDays: 0, positions: [] };
  assert.equal(refundState(paid, fresh).can, true);
  assert.equal(refundState(paid, { ...fresh, tradingDays: 1 }).can, false);
  assert.equal(refundState(paid, { ...fresh, positions: [{ symbol: 'BTC-PERP' }] }).can, false);
  assert.equal(refundState(paid, { ...fresh, status: 'withdrawn' }).can, false);
  assert.equal(refundState(paid, { ...fresh, status: 'breached' }).can, false);
  assert.equal(refundState(paid, null).can, false);
  assert.equal(refundState({ ...paid, status: 'refund_pending' }, fresh).can, false);
  assert.equal(refundState({ ...paid, status: 'created' }, fresh).can, false);
});

test('주문 행은 상태를 사람 말로, 계정은 실제 발급됐을 때만 보여 준다', () => {
  const accounts = new Map([[7, { id: 7, status: 'active', tradingDays: 0, positions: [] }]]);
  const row = orderRow({ orderId: 'o1', status: 'paid', accountId: 7, amountKrw: 190000 }, accounts);
  assert.equal(row.label, '결제 완료');
  assert.equal(row.amountText, '190,000원');
  assert.equal(row.accountText, '계정 #7');
  assert.equal(row.refund.can, true);
  const ghost = orderRow({ orderId: 'o2', status: 'paid', accountId: null, amountKrw: 190000 }, accounts);
  assert.equal(ghost.accountText, '—');
  assert.equal(ghost.refund.can, false);
  const refunded = orderRow({ orderId: 'o3', status: 'refunded', accountId: 7, amountKrw: 190000 }, accounts);
  assert.equal(refunded.accountText, '계정 #7 · 닫힘');
  assert.equal(refunded.tone, 'bad');
  assert.equal(refunded.refund.can, false);
  assert.equal(hasPendingOrder([{ status: 'paid' }, { status: 'refund_pending' }]), true);
  assert.equal(hasPendingOrder([{ status: 'paid' }, { status: 'refunded' }]), false);
});

test('같은 상품의 주문 키는 재전송·새로고침에도 그대로다', () => {
  const store = fakeStore();
  let made = 0;
  const make = () => `ord-key-${(made += 1)}`;
  const first = startPurchase(store, 'omp-2step-25k@1', make);
  assert.equal(startPurchase(store, 'omp-2step-25k@1', make), first, '재전송은 같은 키를 쓴다');
  assert.notEqual(startPurchase(store, 'omp-session-50k@1', make), first, '다른 상품은 다른 키');
  // 주문 id를 함께 기억해야 새로고침한 화면이 그 상품의 주문을 이어받는다.
  rememberOrder(store, 'omp-2step-25k@1', 'ord_1');
  assert.deepEqual(purchaseSlot(store, 'omp-2step-25k@1'), { key: first, orderId: 'ord_1' });
  assert.equal(purchaseSlot(store, 'omp-session-50k@1').orderId, null, '다른 상품의 주문 id가 섞이지 않는다');
  // 주문이 끝나면 슬롯을 비우고 다음 구매는 새 키로 시작한다.
  endPurchase(store, 'omp-2step-25k@1');
  assert.equal(purchaseSlot(store, 'omp-2step-25k@1'), null);
  assert.notEqual(startPurchase(store, 'omp-2step-25k@1', make), first);
  // 저장된 값이 깨졌거나 서버가 거부하는 모양이면 없는 것으로 본다.
  store.setItem('oh-my-prop.checkout.omp-2step-25k@1', '{not json');
  assert.equal(purchaseSlot(store, 'omp-2step-25k@1'), null);
  store.setItem('oh-my-prop.checkout.omp-2step-25k@1', JSON.stringify({ key: 'bad key!', orderId: 'ord_9' }));
  assert.equal(purchaseSlot(store, 'omp-2step-25k@1'), null);
  assert.match(startPurchase(store, 'omp-2step-25k@1', make), /^ord-key-\d+$/);
});
