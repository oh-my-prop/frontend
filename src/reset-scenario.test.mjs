import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateResetScenario } from './reset-scenario.js';

const base = {
  initialBalance: '100000',
  previousResetBalance: '100000',
  newResetBalance: '102000',
  currentEquity: '96000',
};

const calculate = (changes = {}) => calculateResetScenario({ ...base, ...changes });

test('illustrates an increase in the daily floor at reset', () => {
  const { before, after } = calculate();
  assert.deepEqual(before, {
    dailyFloor: 9500000, maxFloor: 9000000,
    dailyRemaining: 100000, maxRemaining: 600000,
    limitingRemaining: 100000, limitingRule: 'daily',
  });
  assert.deepEqual(after, {
    dailyFloor: 9700000, maxFloor: 9000000,
    dailyRemaining: -100000, maxRemaining: 600000,
    limitingRemaining: -100000, limitingRule: 'daily',
  });
  assert.equal(before.dailyRemaining < 0, false);
  assert.equal(after.dailyRemaining < 0, true);
});

test('distinguishes equality from being below a floor', () => {
  const { before, after } = calculate({ currentEquity: '97000' });
  assert.equal(before.dailyRemaining, 200000);
  assert.equal(after.dailyRemaining, 0);
  assert.equal(after.dailyRemaining < 0, false);
  assert.equal(calculate({ currentEquity: '96999.99' }).after.dailyRemaining, -1);
});

test('handles a decrease in reset balance and fractional-cent floors', () => {
  const { before, after } = calculate({
    initialBalance: '100.01', previousResetBalance: '102.00',
    newResetBalance: '100.00', currentEquity: '96.00',
  });
  assert.equal(before.dailyFloor, 9700);
  assert.equal(before.dailyRemaining, -100);
  assert.equal(after.dailyFloor, 9500);
  assert.equal(after.dailyRemaining, 100);
  assert.equal(before.maxFloor, 9001);
  assert.equal(after.maxFloor, 9001);
  assert.equal(before.maxRemaining, after.maxRemaining);
});

test('delegates validation of each input to the risk calculator', () => {
  for (const field of Object.keys(base)) {
    for (const value of ['', '-1', '1.234', '1e3', 1, null, undefined, '90071992547409.92']) {
      assert.throws(() => calculate({ [field]: value }), Error, `${field}: ${value}`);
    }
  }
  assert.throws(() => calculateResetScenario(null), Error);
  assert.throws(() => calculateResetScenario(undefined), Error);
});
