import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRisk } from './risk.js';

const base = {
  initialBalance: '100000',
  dailyStartEquity: '100000',
  currentEquity: '97000',
  dailyLossPercent: '5',
  maxLossPercent: '10',
};

const calculate = (changes = {}) => calculateRisk({ ...base, ...changes });

test('calculates fixed floors and remaining amounts in cents', () => {
  assert.deepEqual(calculate(), {
    dailyFloor: 9500000,
    maxFloor: 9000000,
    dailyRemaining: 200000,
    maxRemaining: 700000,
    limitingRemaining: 200000,
    limitingRule: 'daily',
  });
});

test('identifies maximum and tied limiting rules', () => {
  assert.equal(calculate({ dailyStartEquity: '90000' }).limitingRule, 'maximum');
  const tied = calculate({ dailyStartEquity: '95000', currentEquity: '90000' });
  assert.equal(tied.dailyRemaining, 0);
  assert.equal(tied.maxRemaining, 0);
  assert.equal(tied.limitingRemaining, 0);
  assert.equal(tied.limitingRule, 'both');
});

test('preserves equality at a floor and negative remaining below it', () => {
  const atFloor = calculate({ currentEquity: '95000' });
  assert.equal(atFloor.dailyRemaining, 0);
  assert.equal(atFloor.limitingRemaining, 0);
  const below = calculate({ currentEquity: '89999.99' });
  assert.equal(below.dailyRemaining, -500001);
  assert.equal(below.maxRemaining, -1);
  assert.equal(below.limitingRemaining, -500001);
});

test('rounds fractional-cent floors upward, including negative floors', () => {
  const positive = calculate({
    initialBalance: '100.01', dailyStartEquity: '100.01', currentEquity: '97.50',
    dailyLossPercent: '2.5', maxLossPercent: '2.5',
  });
  assert.equal(positive.dailyFloor, 9751);
  assert.equal(positive.maxFloor, 9751);
  assert.equal(positive.limitingRemaining, -1);
  assert.equal(positive.limitingRule, 'both');

  const negative = calculate({
    initialBalance: '0.03', dailyStartEquity: '0', currentEquity: '0',
    dailyLossPercent: '50', maxLossPercent: '50',
  });
  assert.equal(negative.dailyFloor, -1);
  assert.equal(negative.maxFloor, 2);
  assert.equal(negative.dailyRemaining, 1);
  assert.equal(negative.maxRemaining, -2);
});

test('accepts zero monetary values and percentage endpoints', () => {
  const result = calculate({
    initialBalance: '0', dailyStartEquity: '0', currentEquity: '0',
    dailyLossPercent: '0.01', maxLossPercent: '100',
  });
  assert.deepEqual(result, {
    dailyFloor: 0, maxFloor: 0, dailyRemaining: 0, maxRemaining: 0,
    limitingRemaining: 0, limitingRule: 'both',
  });
});

test('rejects malformed, negative, non-string, missing, and out-of-range input', () => {
  for (const value of ['', '-1', '+1', '1.234', '1.', '.5', '1e3', 'NaN', '1,000', 1, null, undefined]) {
    assert.throws(() => calculate({ initialBalance: value }), Error, `initialBalance: ${value}`);
  }
  for (const field of ['dailyLossPercent', 'maxLossPercent']) {
    for (const value of ['0', '0.00', '100.01', '-1', '1.001', '']) {
      assert.throws(() => calculate({ [field]: value }), Error, `${field}: ${value}`);
    }
  }
  for (const field of ['dailyStartEquity', 'currentEquity']) {
    assert.throws(() => calculate({ [field]: '-0.01' }), Error);
  }
  assert.throws(() => calculateRisk(null), Error);
  assert.throws(() => calculate({ initialBalance: '90071992547409.92' }), Error);
});

test('keeps output within safe integer bounds without intermediate overflow', () => {
  const largest = '90071992547409.91';
  const result = calculate({
    initialBalance: largest, dailyStartEquity: largest, currentEquity: largest,
    dailyLossPercent: '100', maxLossPercent: '100',
  });
  assert.equal(result.dailyFloor, 0);
  assert.equal(result.dailyRemaining, Number.MAX_SAFE_INTEGER);
  assert.equal(result.maxRemaining, Number.MAX_SAFE_INTEGER);
  assert.throws(() => calculate({
    initialBalance: largest, dailyStartEquity: '0', currentEquity: largest,
    dailyLossPercent: '100', maxLossPercent: '100',
  }), /허용 범위/);
});
