import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAID_NOTICE, formatReturnBps, leaderboardRows, parseProgramQuery, programCard, rulesDocument, sortPrograms, statusBadge,
} from './view.js';

const seasonSpec = {
  program: 'omp-season-25k',
  version: 1,
  description: '무료 시즌 챌린지.',
  currency: 'USD',
  initialBalanceCents: 2500000,
  tradingDay: { resetTime: '00:00' },
  instruments: [{ symbol: 'BTC-PERP', priceDecimals: 1, qtyDecimals: 3, feeBps: 4, slippageBps: 1, maxLeverage: 5 }],
  phases: [{ id: 'season', rules: [
    { id: 'daily', kind: 'daily_loss', limitBps: 500, basis: 'max_balance_equity' },
    { id: 'max', kind: 'max_loss_static', limitBps: 1000 },
  ] }],
};
const season = { program: 'omp-season-25k', version: 1, free: true, available: true, initialBalanceCents: 2500000, phases: ['season'], rulesSha256: 'a'.repeat(64) };
const paid = { program: 'omp-2step-25k', version: 1, free: false, available: false, initialBalanceCents: 2500000, phases: ['eval_1', 'eval_2', 'funded'] };

test('free programs sort first', () => {
  assert.deepEqual(sortPrograms([paid, season]).map((item) => item.program), ['omp-season-25k', 'omp-2step-25k']);
});

test('free season card is joinable and links to rules and leaderboard', () => {
  const card = programCard(season, seasonSpec);
  assert.equal(card.name, '무료 시즌 챌린지');
  assert.equal(card.canJoin, true);
  assert.equal(card.balanceText, '가상 잔고 $25,000.00');
  assert.deepEqual(card.chips.map((chip) => chip.text), ['하루 최대 손실 $1,250.00', '전체 최대 손실 $2,500.00']);
  assert.equal(card.rulesHref, '/rules.html?program=omp-season-25k&version=1');
  assert.equal(card.leaderboardHref, '/leaderboard.html?program=omp-season-25k&version=1');
  assert.match(card.status.text, /보상 없음/);
});

test('paid program card shows only the pending notice, never joinable', () => {
  const card = programCard({ ...paid, available: true }, null);
  assert.equal(card.canJoin, false);
  assert.equal(card.status.text, PAID_NOTICE);
  assert.equal(card.leaderboardHref, null);
  assert.equal(card.phasesText, '평가 1단계 → 평가 2단계 → 펀딩');
  assert.deepEqual(card.chips, []);
  assert.doesNotMatch(JSON.stringify(card), /₩|원\b|80%/);
});

test('return percent uses integer basis points with a sign', () => {
  assert.equal(formatReturnBps(1234), '+12.34%');
  assert.equal(formatReturnBps(0), '0%');
  assert.equal(formatReturnBps(-5), '−0.05%');
  assert.equal(formatReturnBps(10), '+0.1%');
});

test('leaderboard rows keep the anonymous label and give a text badge', () => {
  const rows = leaderboardRows([
    { rank: 1, label: '트레이더 #7', status: 'passed', returnBps: 250, tradingDays: 3 },
    { rank: 2, label: '트레이더 #3', status: 'active', returnBps: -120, tradingDays: 1 },
  ]);
  assert.deepEqual(rows.map((row) => [row.rank, row.label, row.returnText, row.direction, row.tradingDaysText, row.badge.text]), [
    [1, '트레이더 #7', '+2.5%', 'up', '3일', '통과'],
    [2, '트레이더 #3', '−1.2%', 'down', '1일', '진행 중'],
  ]);
  assert.deepEqual(leaderboardRows(undefined), []);
  assert.equal(statusBadge('weird').text, 'weird');
});

test('program query accepts only a code and a positive integer version', () => {
  assert.deepEqual(parseProgramQuery('?program=omp-season-25k&version=2'), { program: 'omp-season-25k', version: 2 });
  assert.equal(parseProgramQuery('?program=omp-season-25k'), null);
  assert.equal(parseProgramQuery('?program=../x&version=1'), null);
  assert.equal(parseProgramQuery('?program=omp&version=0'), null);
  assert.equal(parseProgramQuery(''), null);
});

test('rules document is generated from the spec with describeRule', () => {
  const doc = rulesDocument({ rulesSha256: 'abcdef0123456789'.repeat(4), spec: seasonSpec });
  assert.equal(doc.shortSha, 'abcdef012345');
  assert.equal(doc.phases[0].label, '시즌');
  assert.equal(doc.phases[0].rules[0].title, '일일 손실 한도 5% ($1,250.00)');
  assert.match(doc.phases[0].rules[0].detail, /거래일 시작 잔고와 에쿼티 중 큰 값/);
  assert.deepEqual(doc.instruments[0], { symbol: 'BTC-PERP', feeText: '0.04%', slippageText: '0.01%', leverageText: '5배' });
});
