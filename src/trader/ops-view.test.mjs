import test from 'node:test';
import assert from 'node:assert/strict';
import { adverseVerdict, appealReasonOk, appealStatus, groupSecret, verdictFacts } from './ops-view.js';

const breach = { seq: 9, ts: '2026-11-23T01:02:03.000Z', type: 'verdict', verdict: 'breached', ruleId: 'daily', result: { kind: 'daily_loss', thresholdCents: 2375000, observedCents: 2088079 } };

test('the latest adverse verdict is found, passes are ignored', () => {
  assert.equal(adverseVerdict([]), null);
  assert.equal(adverseVerdict([{ type: 'verdict', verdict: 'phase_passed', seq: 3 }]), null);
  assert.equal(adverseVerdict([{ type: 'order_filled', seq: 1 }, breach, { type: 'order_filled', seq: 10 }]), breach);
});

test('verdict facts show rule, line, observation, time and evidence', () => {
  const { title, facts } = verdictFacts(breach);
  assert.match(title, /종료/);
  const byLabel = Object.fromEntries(facts.map((fact) => [fact.label, fact.value]));
  assert.equal(byLabel['규칙'], '일일 손실 한도 (daily)');
  assert.equal(byLabel['한도선'], '$23,750.00');
  assert.equal(byLabel['그때 에쿼티'], '$20,880.79');
  assert.equal(byLabel['근거 기록'], '#9');
  const idle = verdictFacts({ seq: 4, ts: breach.ts, type: 'verdict', verdict: 'expired', ruleId: 'idle', result: { kind: 'inactivity', threshold: 30, observed: 30 } });
  assert.ok(idle.facts.some((fact) => fact.value === '30일'));
});

test('appeal states read as plain sentences', () => {
  assert.equal(appealStatus(null), null);
  assert.equal(appealStatus({ status: 'open', createdAt: breach.ts }).tone, 'info');
  assert.match(appealStatus({ status: 'upheld', decisionNote: '규칙대로 판정됨' }).text, /판정 유지 — 규칙대로/);
  assert.match(appealStatus({ status: 'overturned', decisionNote: '시세 이상', reissuedAccountId: 7 }).text, /#7/);
});

test('appeal reasons and secrets are shaped for people', () => {
  assert.equal(appealReasonOk('짧음'), false);
  assert.equal(appealReasonOk('  시세가 이상했습니다. 확인 부탁드립니다.  '), true);
  assert.equal(appealReasonOk('가'.repeat(2001)), false);
  assert.equal(groupSecret('JBSWY3DPEHPK3PXP'), 'JBSW Y3DP EHPK 3PXP');
  assert.equal(groupSecret('ABCDE'), 'ABCD E');
});
