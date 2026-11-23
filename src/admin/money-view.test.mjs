// 운영 돈 화면의 표시 규칙(src/admin/money-view.js). 잡으려는 버그는
// "사고가 숫자 뒤에 숨는 것"과 "쓸 수 없는 값을 그대로 찍는 것"이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerRows, moneyAlerts, moneyOrderRow, reserveView } from './money-view.js';

test('준비금이 0인데 빚이 있으면 비율 대신 말로 쓴다', () => {
  // backend/src/money/reserve.js:63 — 준비금 0에 빚이 있으면 ratio는 Infinity다.
  const view = reserveView({ reserveKrw: 0, approvedUnpaidKrw: 300000, outstandingKrw: 300000, ratio: Infinity, halted: true });
  assert.equal(view.ratioText, '준비금 없음');
  assert.equal(view.halted, true);
  assert.equal(view.tone, 'danger');
  // 준비금도 빚도 없으면 중단이 아니다(비율 0).
  const empty = reserveView({ reserveKrw: 0, approvedUnpaidKrw: 0, outstandingKrw: 0, ratio: 0, halted: false });
  assert.equal(empty.ratioText, '0.0%');
  assert.equal(empty.tone, 'ok');
  assert.equal(reserveView({ reserveKrw: 100000, outstandingKrw: 50000, ratio: 0.5, halted: false }).ratioText, '50.0%');
  assert.equal(reserveView(null).ratioText, '—');
});

test('미정산 저널과 데드레터는 0이 아니면 경고로 올라온다', () => {
  assert.deepEqual(moneyAlerts({ unbalancedJournals: [], outbox: { pending: 3, deadLetters: 0 } }), []);
  const alerts = moneyAlerts({ unbalancedJournals: [{ journalId: 'j1', total: 100 }], outbox: { pending: 0, deadLetters: 2 } });
  assert.deepEqual(alerts.map((alert) => alert.kind), ['unbalanced', 'dead_letters']);
  assert.ok(alerts.every((alert) => alert.tone === 'danger'));
  assert.deepEqual(moneyAlerts({}), []);
});

test('서버가 계정과목을 더 보내도 빠뜨리지 않는다', () => {
  const rows = ledgerRows({ 'revenue:evaluation_fee': -50000, 'cash:pg_clearing': 50000, 'asset:unknown_new': 1 });
  assert.deepEqual(rows.map((row) => row.account), ['cash:pg_clearing', 'revenue:evaluation_fee', 'asset:unknown_new']);
  assert.equal(rows[0].label, '정산 대기 현금');
  assert.equal(rows[2].label, 'asset:unknown_new');
  assert.deepEqual(ledgerRows(), []);
});

test('결제됐는데 계정이 없는 주문은 한눈에 보인다', () => {
  const broken = moneyOrderRow({ orderId: 'ord_1', status: 'paid', amountKrw: 99000, accountId: null, userId: 7, program: 'eval-10k', version: 1 });
  assert.equal(broken.warn, true);
  assert.equal(broken.accountText, '없음(확인 필요)');
  const good = moneyOrderRow({ orderId: 'ord_2', status: 'paid', amountKrw: 99000, accountId: 12, userId: 7, program: 'eval-10k', version: 1 });
  assert.equal(good.warn, false);
  assert.equal(good.accountText, '#12');
  assert.equal(good.productText, 'eval-10k v1');
  // 아직 결제 전인 주문에 계정이 없는 것은 정상이다.
  const created = moneyOrderRow({ orderId: 'ord_3', status: 'created', amountKrw: 99000, accountId: null });
  assert.equal(created.warn, false);
  assert.equal(created.accountText, '—');
  assert.equal(created.productText, '—');
});
