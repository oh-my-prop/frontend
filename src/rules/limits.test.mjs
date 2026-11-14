import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEvent, createTracker, limitCards } from './limits.js';

// Same shared fixtures the backend engine runs (vendored from oh-my-prop/data).
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/rules');
const LOSS_KINDS = new Set(['daily_loss', 'max_loss_static', 'max_loss_trailing']);

for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
  const fixture = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  const expectations = fixture.expect.filter((item) => LOSS_KINDS.has(item.ruleKind));
  if (expectations.length === 0) continue;
  test(`display lines match shared fixture ${file}`, () => {
    let tracker = createTracker(fixture);
    const snapshots = fixture.events.map((event) => {
      tracker = applyEvent(tracker, event);
      return limitCards(tracker);
    });
    for (const expected of expectations) {
      const card = snapshots[expected.afterEvent].cards.find((item) => item.kind === expected.ruleKind);
      assert.equal(Number(card.lineCents), expected.thresholdCents, `${file} line after ${expected.afterEvent}`);
      assert.equal(card.reached, expected.outcome === 'breach', `${file} reached after ${expected.afterEvent}`);
    }
  });
}

test('warning levels follow the remaining share of each allowance', () => {
  const rules = [{ kind: 'daily_loss', limitBps: 500, basis: 'balance' }, { kind: 'max_loss_static', limitBps: 1000 }];
  let tracker = createTracker({ initialBalanceCents: 10000000, rules });
  const at = (equity) => limitCards(applyEvent(tracker, { type: 'mark_to_market', equityCents: equity }));
  assert.equal(at(10000000).cards[0].warning, 'normal');
  assert.equal(at(9750000).cards[0].warning, 'caution'); // 2,500 of 5,000 left
  assert.equal(at(9600000).cards[0].warning, 'danger'); // 1,000 left = 20%
  assert.equal(at(9540000).cards[0].warning, 'critical'); // 400 left = 8%
  assert.equal(at(9500000).cards[0].warning, 'reached');
  const view = at(9700000);
  assert.equal(view.nearestRuleId, 'daily_loss#0');
  assert.equal(Number(view.cards[1].remainingCents), 700000);
});
