import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWinRate, tradeReview } from './review.js';

let seq = 0;
const opened = (cents) => ({ seq: ++seq, type: 'account_opened', initialBalanceCents: cents });
const fill = (side, qty, pnl, fee = 0, symbol = 'BTC-PERP') => ({ seq: ++seq, type: 'order_filled', symbol, side, qty, price: '60000.0', feeCents: fee, realizedPnlCents: pnl, reason: 'market' });
// One round trip: open (costs only its fee) then close with the given result.
const round = (pnl) => [fill('buy', '1.000', 0), fill('sell', '1.000', pnl)];

test('no trades: zeros, no win rate, no breach', () => {
  const review = tradeReview([opened(10_000_000)]);
  assert.equal(review.netPnlCents, 0);
  assert.equal(review.maxDrawdownCents, 0);
  assert.deepEqual([review.closedTrades, review.wins, review.losses, review.flat], [0, 0, 0, 0]);
  assert.equal(review.winRateTenths, null);
  assert.equal(formatWinRate(review.winRateTenths), '계산할 승패 거래 없음');
  assert.equal(review.firstBreach, null);
  assert.equal(review.best, null);
  assert.equal(review.worst, null);
});

test('−5,000 then +6,000: net +1,000, 50%, drawdown 5,000', () => {
  const review = tradeReview([opened(10_000_000), ...round(-500_000), ...round(600_000)]);
  assert.equal(review.netPnlCents, 100_000);
  assert.deepEqual([review.wins, review.losses, review.flat], [1, 1, 0]);
  assert.equal(formatWinRate(review.winRateTenths), '50.0%');
  assert.equal(review.maxDrawdownCents, 500_000);
  assert.equal(review.best.pnlCents, 600_000);
  assert.equal(review.worst.pnlCents, -500_000);
});

test('+2,000 / −3,000 / 0 / +1,000: break-even excluded, 66.7%, drawdown 3,000', () => {
  const review = tradeReview([opened(10_000_000), ...round(200_000), ...round(-300_000), ...round(0), ...round(100_000)]);
  assert.equal(review.netPnlCents, 0);
  assert.deepEqual([review.wins, review.losses, review.flat], [2, 1, 1]);
  assert.equal(formatWinRate(review.winRateTenths), '66.7%');
  assert.equal(review.maxDrawdownCents, 300_000);
});

test('fees count toward the balance path but opening fills are not trades', () => {
  const review = tradeReview([opened(10_000_000), fill('buy', '0.500', -40, 40), fill('buy', '0.500', -40, 40), fill('sell', '1.000', 1_000, 80)]);
  assert.equal(review.closedTrades, 1);
  assert.equal(review.feesCents, 160);
  assert.equal(review.netPnlCents, 920);
  assert.equal(review.maxDrawdownCents, 80);
});

test('partial closes and flips count as closing fills; symbols are tracked apart', () => {
  const review = tradeReview([
    opened(10_000_000),
    fill('sell', '2.000', 0),                    // open short 2
    fill('buy', '0.5', 300, 0, 'ETH-PERP'),      // ETH opens long, not a close
    fill('buy', '1.000', 500),                   // partial close of BTC short
    fill('buy', '3.000', -200),                  // closes the rest and flips long
    fill('sell', '0.500', 100, 0, 'ETH-PERP'),   // closes ETH
  ]);
  assert.equal(review.closedTrades, 3);
  assert.deepEqual([review.wins, review.losses], [2, 1]);
});

test('first breach verdict is reported', () => {
  const review = tradeReview([opened(10_000_000), ...round(-600_000), { seq: ++seq, type: 'verdict', verdict: 'breached', ruleId: 'daily', ts: '2026-11-23T00:00:00Z' }]);
  assert.equal(review.firstBreach.ruleId, 'daily');
});

test('amounts past the safe integer range are not shown as wrong numbers', () => {
  const review = tradeReview([opened('9007199254740991'), ...round('9007199254740991')]);
  assert.equal(review.netPnlCents, 9007199254740991);
  assert.equal(review.trades[0].balanceCents, null);
  assert.equal(review.initialBalanceCents, 9007199254740991);
});
