import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAID_NOTICE, formatReturnBps, leaderboardRows, parseProgramQuery, programCard, publicStatsView,
  rulesDocument, sortPrograms, statusBadge,
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

test('a price appears only when the server says the product is on sale', () => {
  const onSale = programCard({ ...paid, saleState: 'for_sale', priceKrw: 190000 }, null);
  assert.equal(onSale.priceText, '190,000원');
  assert.equal(onSale.priceLabel, '190,000원');
  assert.equal(onSale.canBuy, true);
  assert.equal(onSale.kindText, '유료 평가');

  // 플래그가 꺼졌거나 가격이 없으면 서버가 priceKrw를 주지 않는다. 화면도 숫자를 만들지 않는다.
  for (const program of [{ ...paid, saleState: 'preparing', priceKrw: null }, { ...paid, saleState: 'for_sale', priceKrw: null }]) {
    const card = programCard(program, null);
    assert.equal(card.priceText, null, JSON.stringify(program));
    assert.equal(card.priceLabel, '준비 중');
    assert.equal(card.canBuy, false);
    assert.equal(card.status.text, PAID_NOTICE);
    assert.doesNotMatch(JSON.stringify(card), /\d{1,3},\d{3}원|₩/);
  }

  // 무료 시즌은 결제가 없다. saleState가 없는 옛 서버 응답도 유료는 준비 중으로 본다.
  assert.equal(programCard({ ...season, saleState: 'free' }, seasonSpec).priceLabel, '무료');
  assert.equal(programCard(paid, null).saleState, 'preparing');
});

test('public stats hide every number for a small sample instead of showing zeros', () => {
  const view = publicStatsView({
    generatedAt: '2026-11-24T02:03:04.000Z',
    programs: [
      { program: 'omp-season-25k', version: 1, accounts: 12, traded: 9, passed: 2, breached: 5, expired: 1, running: 4, passRateBps: 2500, smallSample: false },
      { program: 'omp-2step-25k', version: 1, accounts: null, traded: null, passed: null, breached: null, expired: null, running: null, passRateBps: null, smallSample: true },
    ],
  });
  assert.equal(view.generatedAtText, '2026-11-24 02:03 UTC');
  assert.equal(view.shown, 1);
  assert.deepEqual(
    [view.rows[0].accountsText, view.rows[0].tradedText, view.rows[0].runningText, view.rows[0].passedText, view.rows[0].breachedText, view.rows[0].expiredText, view.rows[0].passRateText],
    ['12개', '9개', '4개', '2개', '5개', '1개', '25%'],
  );
  assert.equal(view.rows[1].small, true);
  assert.equal(view.rows[1].accountsText, '아직 공개할 표본이 없습니다');
  assert.doesNotMatch(JSON.stringify(view.rows[1]), /\d개|%/);

  // 종료된 계정이 0이면 서버가 passRateBps를 주지 않는다. 0%로 바꿔 그리면 거짓이 된다.
  const noneClosed = publicStatsView({ programs: [{ program: 'omp-season-25k', version: 1, accounts: 7, traded: 3, passed: 0, breached: 0, expired: 0, running: 7, passRateBps: null, smallSample: false }] });
  assert.equal(noneClosed.rows[0].passRateText, '—');
  assert.equal(noneClosed.rows[0].runningText, '7개');
  assert.equal(noneClosed.generatedAtText, null);

  assert.deepEqual(publicStatsView(undefined), { generatedAtText: null, rows: [], shown: 0 });
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
