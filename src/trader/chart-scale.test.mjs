import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout, mergeCandles, midText, niceStep, parseCandles, priceTicks, timeLabelIndices } from './chart-scale.js';

const bar = (minute, o, h, l, c) => ({ t: new Date(Date.UTC(2026, 10, 22, 10, minute)).toISOString(), o, h, l, c, n: 1 });

test('nice steps and ticks land on 1/2/5 multiples', () => {
  assert.equal(niceStep(100, 5), 20);
  assert.equal(niceStep(7, 5), 2);
  assert.equal(niceStep(0.03, 3), 0.01);
  assert.deepEqual(priceTicks(60003, 60047, 4), [60020, 60040]);
  assert.deepEqual(priceTicks(60003, 60047, 8), [60010, 60020, 60030, 60040]);
});

test('layout keeps the newest bars, right-aligned, inside the plot', () => {
  const bars = parseCandles(Array.from({ length: 200 }, (_, i) => bar(i % 60, '100', String(101 + i), '99', '100.5')));
  const layout = buildLayout(bars, 400, 300);
  assert.ok(layout.visible.length < bars.length, 'older bars scroll off');
  assert.equal(layout.visible.at(-1), bars.at(-1));
  assert.ok(Math.abs(layout.x(layout.visible.length - 1) - (layout.plot.right - layout.spacing / 2)) < 1e-9);
  const high = Math.max(...layout.visible.map((b) => b.h));
  assert.ok(layout.y(high) > layout.plot.top && layout.y(99) < layout.plot.bottom, 'margin above the high and below the low');
  assert.equal(layout.indexAt(layout.x(3)), 3);
  assert.equal(layout.indexAt(layout.plot.right + 30), -1);
  assert.ok(Math.abs(layout.priceAt(layout.y(150)) - 150) < 1e-9);
});

test('layout copes with no bars and a flat market', () => {
  const empty = buildLayout([], 400, 300);
  assert.equal(empty.visible.length, 0);
  assert.ok(empty.max > empty.min);
  const flat = buildLayout(parseCandles([bar(0, '5', '5', '5', '5')]), 400, 300);
  assert.ok(flat.max > 5 && flat.min < 5);
});

test('time labels fall on round minutes and do not crowd', () => {
  const bars = parseCandles(Array.from({ length: 30 }, (_, i) => bar(i, '1', '1', '1', '1')));
  assert.deepEqual(timeLabelIndices(bars, 14), [0, 5, 10, 15, 20, 25]);
  assert.deepEqual(timeLabelIndices(bars, 70), bars.map((_, i) => i));
});

test('merging a refresh replaces the still-open bar instead of duplicating it', () => {
  const current = [bar(0, '1', '2', '1', '2'), bar(1, '2', '3', '2', '3')];
  const fresh = [bar(1, '2', '4', '2', '4'), bar(2, '4', '4', '4', '4')];
  assert.deepEqual(mergeCandles(current, fresh).map((b) => b.h), ['2', '4', '4']);
  assert.equal(mergeCandles(current, []), current);
  assert.equal(mergeCandles(current, fresh, 2).length, 2);
});

test('mid price uses integer math and rounds down to the tick', () => {
  assert.equal(midText('60000.0', '60000.5', 1), '60000.2');
  assert.equal(midText('0.05', '0.06', 2), '0.05');
  assert.equal(midText('10', '13', 0), '11');
  assert.equal(midText('1703.56', '1703.57', 2), '1703.56');
});
