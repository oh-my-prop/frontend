import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBps, formatCents, formatSignedCents } from './format.js';
import { describeEvent, describeRule, limitCards, objectiveCards, statusBanner, stopLossPreview } from './view.js';

const BTC = { symbol: 'BTC-PERP', priceDecimals: 1, qtyDecimals: 3, multiplier: 1, feeBps: 4, slippageBps: 1, maxLeverage: 5 };

test('money and rates format without floating point', () => {
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.equal(formatCents(-5), '−$0.05');
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatSignedCents(934), '+$9.34');
  assert.equal(formatSignedCents(-934), '−$9.34');
  assert.equal(formatBps(500), '5%');
  assert.equal(formatBps(4445), '44.45%');
  assert.equal(formatBps(50), '0.5%');
  assert.equal(formatCents('9007199254740991'), '$90,071,992,547,409.91');
});

test('rule descriptions come from the spec', () => {
  assert.equal(describeRule({ kind: 'daily_loss', limitBps: 500, basis: 'max_balance_equity' }, 2500000).title, '일일 손실 한도 5% ($1,250.00)');
  assert.match(describeRule({ kind: 'daily_loss', limitCents: 100000, basis: 'balance', enforcement: 'pause' }, 5000000).detail, /다음 거래일까지 거래가 정지/);
  assert.match(describeRule({ kind: 'max_loss_trailing', limitCents: 200000, mode: 'end_of_day', lockAtInitial: true, lockOffsetCents: 10000 }, 5000000).detail, /초기 잔고 \+ \$100\.00/);
  assert.equal(describeRule({ kind: 'min_profitable_days', days: 5, minDayProfitCents: 15000 }, 5000000).detail, '마감된 거래일 중 순이익이 $150.00 이상인 날만 셉니다.');
  assert.match(describeRule({ kind: 'max_position', maxQtyBySymbol: { 'BTC-PERP': '2' } }, 1).detail, /BTC-PERP 2/);
});

const RULES = [
  { id: 'daily', kind: 'daily_loss', limitBps: 500, basis: 'max_balance_equity' },
  { id: 'max', kind: 'max_loss_static', limitBps: 1000 },
  { id: 'target', kind: 'profit_target', targetBps: 800 },
  { id: 'days', kind: 'min_trading_days', days: 4 },
  { id: 'consistency', kind: 'consistency', maxDayShareBps: 4000, scope: 'payout_cycle' },
];

test('limit cards show remaining room, warning level and the nearest line', () => {
  const results = [
    { ruleId: 'daily', kind: 'daily_loss', outcome: 'none', thresholdCents: 2375000, observedCents: 2400000 },
    { ruleId: 'max', kind: 'max_loss_static', outcome: 'none', thresholdCents: 2250000, observedCents: 2400000 },
  ];
  const [daily, max] = limitCards(RULES, results, 2500000);
  assert.equal(daily.remainingCents, 25000); // $250 of $1,250 = 20%
  assert.equal(daily.warning, 'danger');
  assert.equal(daily.nearest, true);
  assert.equal(max.remainingCents, 150000); // $1,500 of $2,500 = 60%
  assert.equal(max.warning, 'normal');
  assert.equal(max.nearest, false);
  const reached = limitCards(RULES, [{ ...results[0], observedCents: 2375000 }], 2500000);
  assert.equal(reached[0].warning, 'reached');
});

test('objective cards report progress and the consistency requirement', () => {
  const results = [
    { ruleId: 'target', kind: 'profit_target', outcome: 'none', thresholdCents: 2700000, observedCents: 2600000 },
    { ruleId: 'days', kind: 'min_trading_days', outcome: 'none', threshold: 4, observed: 3 },
    { ruleId: 'consistency', kind: 'consistency', outcome: 'hold', thresholdCents: 40000, observedCents: 70000, shareBps: 7000, requiredProfitCents: 175000 },
  ];
  const [target, days, consistency] = objectiveCards(RULES, results, 2500000);
  assert.deepEqual([target.percent, target.text], [50, '$1,000.00 / $2,000.00']);
  assert.deepEqual([days.percent, days.text, days.met], [75, '3 / 4일', false]);
  assert.match(consistency.text, /최고 수익일 비중 70% \/ 상한 40% · 총수익 \$1,750\.00이 되면 충족/);
  const noProfit = objectiveCards(RULES, [{ ruleId: 'consistency', kind: 'consistency', outcome: 'hold', note: 'no_profit' }], 2500000);
  assert.match(noProfit[0].text, /순이익이 없어/);
});

test('stop-loss preview matches the server fill and fee conventions', () => {
  const preview = stopLossPreview({ instrument: BTC, side: 'buy', qty: '0.500', entryPrice: '60006.6', stopLoss: '59500.0', dailyRemainingCents: 125000 });
  // Stop fill 59500.0 × 0.9999 → 59494.0; move $5,126 × 0.5 = $256.30; fees $12.01 + $11.90
  assert.deepEqual(preview, { available: true, lossCents: 28021, remainingAfterCents: 96979, reachesLimit: false });
  const short = stopLossPreview({ instrument: BTC, side: 'sell', qty: '1.000', entryPrice: '60000.0', stopLoss: '61000.0', dailyRemainingCents: 100000 });
  assert.equal(short.reachesLimit, true);
  assert.equal(stopLossPreview({ instrument: BTC, side: 'buy', qty: '1.000', entryPrice: '60000.0' }).available, false);
  assert.equal(stopLossPreview({ instrument: BTC, side: 'buy', qty: '1.000', entryPrice: '60000.0', stopLoss: '61000.0' }).available, false);
  assert.equal(stopLossPreview({ instrument: BTC, side: 'buy', qty: '0.0001', entryPrice: '60000.0', stopLoss: '59000.0' }).available, false);
});

test('status banners and event lines are human-readable', () => {
  assert.equal(statusBanner({ status: 'active', paused: true }).tone, 'warning');
  assert.equal(statusBanner({ status: 'breached' }).tone, 'danger');
  assert.equal(statusBanner({ status: 'passed' }).tone, 'success');
  assert.equal(
    describeEvent({ type: 'order_filled', symbol: 'BTC-PERP', side: 'sell', qty: '1.000', price: '53994.6', reason: 'forced_breached', realizedPnlCents: -603360, feeCents: 2160 }),
    '체결 · BTC-PERP 매도 1.000 @ 53994.6 (위반 강제 청산) · 확정 손익 −$6,033.60 (수수료 $21.60 포함)',
  );
  assert.equal(
    describeEvent({ type: 'verdict', verdict: 'breached', result: { thresholdCents: 9500000, observedCents: 9396939 } }),
    '판정 · 규칙 위반 · 기준 $95,000.00, 관측 $93,969.39',
  );
});
