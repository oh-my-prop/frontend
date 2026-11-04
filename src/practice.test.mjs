import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSession } from './practice.js';

const base = { initialBalance: '100000', lossPercent: '5', trades: [] };
const evaluate = (changes = {}) => evaluateSession({ ...base, ...changes });

test('starts with the initial balance and fixed allowance', () => {
  assert.deepEqual(evaluate(), {
    initialBalance: 10000000, floor: 9500000, balance: 10000000,
    remaining: 500000, firstBreachIndex: null, events: [],
  });
});

test('records equality as the first breach and retains it through recovery', () => {
  const result = evaluate({ trades: [
    { label: '손실', pnl: '-5000' },
    { label: '회복', pnl: '+6000.00' },
    { label: '다시 손실', pnl: '-7000' },
  ] });
  assert.deepEqual(result, {
    initialBalance: 10000000, floor: 9500000, balance: 9400000,
    remaining: -100000, firstBreachIndex: 0,
    events: [
      { label: '손실', pnl: -500000, balance: 9500000, remaining: 0, atOrBelow: true },
      { label: '회복', pnl: 600000, balance: 10100000, remaining: 600000, atOrBelow: false },
      { label: '다시 손실', pnl: -700000, balance: 9400000, remaining: -100000, atOrBelow: true },
    ],
  });
});

test('replays the remaining trades from the start after deletion', () => {
  const trades = [
    { label: '첫 손실', pnl: '-5' },
    { label: '두 번째 손실', pnl: '-5' },
    { label: '회복', pnl: '10' },
  ];
  const original = evaluate({ initialBalance: '100', trades });
  assert.equal(original.firstBreachIndex, 0);
  const replay = evaluate({ initialBalance: '100', trades: trades.slice(1) });
  assert.equal(replay.firstBreachIndex, 0);
  assert.equal(replay.events[0].balance, 9500);
  assert.equal(replay.balance, 10500);
  const withoutLosses = evaluate({ initialBalance: '100', trades: trades.slice(2) });
  assert.equal(withoutLosses.firstBreachIndex, null);
  assert.equal(withoutLosses.balance, 11000);
});

test('rounds fractional-cent floors upward with exact percentage precision', () => {
  assert.equal(evaluate({ initialBalance: '100.01', lossPercent: '2.5' }).floor, 9751);
  assert.equal(evaluate({ initialBalance: '0.03', lossPercent: '50' }).floor, 2);
  assert.equal(evaluate({ initialBalance: '100', lossPercent: '0.001' }).floor, 10000);
  assert.equal(evaluate({ initialBalance: '1', lossPercent: '100.0000' }).floor, 0);
});

test('allows negative balances and zero or signed trade amounts', () => {
  const result = evaluate({ initialBalance: '100', lossPercent: '50', trades: [
    { label: '손실', pnl: '-150' }, { label: '변동 없음', pnl: '+0.00' },
  ] });
  assert.equal(result.balance, -5000);
  assert.equal(result.remaining, -10000);
  assert.equal(result.firstBreachIndex, 0);
  assert.equal(result.events[1].pnl, 0);
});

test('rejects invalid initial balance, percentages and trade values', () => {
  for (const value of ['', '0', '-1', '+1', '1.234', '1.', '.5', '1e3', '1,000', 1, null, undefined]) {
    assert.throws(() => evaluate({ initialBalance: value }), Error, `initialBalance: ${value}`);
  }
  for (const value of ['', '0', '0.000', '-1', '+1', '100.001', '101', '1.', '.5', '1e2', 5, null]) {
    assert.throws(() => evaluate({ lossPercent: value }), Error, `lossPercent: ${value}`);
  }
  for (const value of ['', '+', '1.001', '1.', '.5', '1e2', '1,000', 1, null]) {
    assert.throws(() => evaluate({ trades: [{ label: '거래', pnl: value }] }), Error, `pnl: ${value}`);
  }
  assert.throws(() => evaluateSession(null), Error);
  assert.throws(() => evaluate({ trades: null }), Error);
  assert.throws(() => evaluate({ trades: [null] }), Error);
  assert.throws(() => evaluate({ trades: Array(1) }), Error);
});

test('requires a nonblank label of at most 80 characters', () => {
  for (const label of ['', ' \n ', '가'.repeat(81), null, 1]) {
    assert.throws(() => evaluate({ trades: [{ label, pnl: '0' }] }), Error);
  }
  const label = '😀'.repeat(80);
  assert.equal(evaluate({ trades: [{ label, pnl: '0' }] }).events[0].label, label);
});

test('checks every monetary result for safe integer overflow', () => {
  const largest = '90071992547409.91';
  assert.equal(evaluate({ initialBalance: largest, lossPercent: '100' }).balance, Number.MAX_SAFE_INTEGER);
  assert.throws(() => evaluate({ initialBalance: '90071992547409.92' }), /허용 범위/);
  assert.throws(() => evaluate({ trades: [{ label: '거래', pnl: '90071992547409.92' }] }), /허용 범위/);
  assert.throws(() => evaluate({ initialBalance: largest, trades: [{ label: '이익', pnl: '0.01' }] }), /허용 범위/);
  assert.throws(() => evaluate({ initialBalance: largest, lossPercent: '0.01', trades: [
    { label: '손실', pnl: `-${largest}` }, { label: '추가 손실', pnl: '-9007199255' },
  ] }), /허용 범위/);
});
