// Pure view models for the public pages (home, leaderboard, rules, transparency).
// Inputs are the plain API payloads; outputs are plain data, so this is testable
// in Node. Rule wording comes from src/trader/view.js so every page says the same
// thing.

import { formatBps, formatCents, formatKrw, formatTimestamp } from '../trader/format.js';
import { describeRule, phaseLabel, programName, programPitch, ruleHighlights } from '../trader/view.js';

export const SIM_NOTICE = '시뮬레이션 계정 — 실제 시장에 주문이 전달되지 않습니다';
export const PAID_NOTICE = '준비 중 — 유료 평가는 법률 검토 후 제공';
export const OFFLINE_NOTICE = '서버에 연결할 수 없어 상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const rulesHref = (code, version) => `/rules.html?program=${encodeURIComponent(code)}&version=${version}`;
export const leaderboardHref = (code, version) => `/leaderboard.html?program=${encodeURIComponent(code)}&version=${version}`;

// 판매 상태는 서버만 정한다(backend: GET /api/v2/programs의 saleState). 서버가
// 값을 주지 않는 구버전이면 "유료 = 준비 중"으로 본다. 값을 추측해서 가격을
// 만들어 내지 않는다: 가격 광고는 법률 게이트 뒤에 있다(전략 03 §4.5).
const SALE_STATES = new Set(['free', 'for_sale', 'preparing']);
export function saleStateOf(program) {
  const given = program?.saleState;
  if (SALE_STATES.has(given)) return given;
  return program?.free ? 'free' : 'preparing';
}

// 숫자 가격은 for_sale일 때만 쓴다. 그 밖에는 null이고 화면에는 아무 숫자도 넣지 않는다.
export function priceTextOf(program) {
  if (saleStateOf(program) !== 'for_sale') return null;
  const price = program?.priceKrw;
  return Number.isSafeInteger(price) && price > 0 ? formatKrw(price) : null;
}

// Free programs first, then by code, so the order is stable whatever the API returns.
export function sortPrograms(programs) {
  return [...programs].sort((a, b) => Number(Boolean(b.free)) - Number(Boolean(a.free)) || String(a.program).localeCompare(String(b.program)));
}

// One comparison row/card. `spec` is the full program spec when it could be loaded.
// A price appears only when the server says the product is on sale and gives the
// amount; "준비 중"에서는 숫자를 만들지 않는다(전략 03 §4.5: 게이트 전 유료 광고 금지).
export function programCard(program, spec) {
  const firstPhase = spec?.phases?.[0];
  const free = Boolean(program.free);
  const saleState = saleStateOf(program);
  const priceText = priceTextOf(program);
  const onSale = saleState === 'for_sale' && priceText !== null;
  let status;
  if (saleState === 'preparing' || (saleState === 'for_sale' && !onSale)) status = { kind: 'soon', symbol: '◷', text: PAID_NOTICE };
  else if (onSale) status = { kind: 'sale', symbol: '₩', text: '판매 중 · 결제하면 평가 계정이 열립니다' };
  else if (program.available) status = { kind: 'open', symbol: '✓', text: '참가 가능 · 보상 없음(순위 기록만)' };
  else status = { kind: 'closed', symbol: '–', text: '현재 열려 있는 시즌이 없습니다' };
  return {
    code: program.program,
    version: program.version,
    free,
    saleState,
    priceText,
    name: programName(program.program),
    pitch: programPitch(program.program, program.description ?? ''),
    kindText: free ? '무료 시즌' : onSale ? '유료 평가' : '유료 평가(준비 중)',
    priceLabel: free ? '무료' : priceText ?? '준비 중',
    balanceText: `가상 잔고 ${formatCents(program.initialBalanceCents ?? spec?.initialBalanceCents ?? 0)}`,
    phasesText: (program.phases ?? spec?.phases?.map((phase) => phase.id) ?? []).map(phaseLabel).join(' → '),
    chips: firstPhase ? ruleHighlights(firstPhase.rules, spec.initialBalanceCents) : [],
    status,
    canJoin: free && Boolean(program.available),
    canBuy: onSale,
    rulesHref: rulesHref(program.program, program.version),
    leaderboardHref: free ? leaderboardHref(program.program, program.version) : null,
  };
}

// Leaderboard -----------------------------------------------------------------------

// Signed percentage from basis points with integer math: 1234 → "+12.34%", −5 → "−0.05%".
export function formatReturnBps(bps) {
  const value = BigInt(bps);
  return value > 0n ? `+${formatBps(value)}` : formatBps(value);
}

const STATUS_BADGES = {
  active: { kind: 'active', symbol: '●', text: '진행 중' },
  passed: { kind: 'passed', symbol: '✓', text: '통과' },
};
export const statusBadge = (status) => STATUS_BADGES[status] ?? { kind: 'other', symbol: '·', text: String(status ?? '알 수 없음') };

// Only the anonymous label the server gives is ever shown; nothing else about the trader.
export function leaderboardRows(entries) {
  return (entries ?? []).map((entry, index) => {
    const rank = Number.isInteger(entry.rank) ? entry.rank : index + 1;
    const returnBps = Number.isInteger(entry.returnBps) ? entry.returnBps : 0;
    return {
      rank,
      label: typeof entry.label === 'string' && entry.label ? entry.label : `트레이더 ${rank}위`,
      returnText: formatReturnBps(returnBps),
      direction: returnBps > 0 ? 'up' : returnBps < 0 ? 'down' : 'flat',
      tradingDaysText: `${Number.isInteger(entry.tradingDays) ? entry.tradingDays : 0}일`,
      badge: statusBadge(entry.status),
    };
  });
}

// Rules page ------------------------------------------------------------------------

// `?program=<code>&version=<n>` → { program, version } or null when missing/invalid.
export function parseProgramQuery(search) {
  const params = new URLSearchParams(search ?? '');
  const program = params.get('program');
  const versionText = params.get('version');
  if (!program || !CODE_PATTERN.test(program)) return null;
  if (versionText == null || !/^[1-9]\d{0,5}$/.test(versionText)) return null;
  return { program, version: Number(versionText) };
}

// Full rule explanation from a spec response `{ rulesSha256, spec }`.
export function rulesDocument({ rulesSha256, spec }) {
  const balance = spec.initialBalanceCents;
  return {
    code: spec.program,
    version: spec.version,
    name: programName(spec.program),
    description: spec.description ?? '',
    sha: rulesSha256,
    shortSha: String(rulesSha256 ?? '').slice(0, 12),
    balanceText: `가상 잔고 ${formatCents(balance)} (${spec.currency ?? 'USD'}, 가상)`,
    resetText: spec.tradingDay?.resetTime ? `거래일 기준 시각 ${spec.tradingDay.resetTime}` : null,
    phases: (spec.phases ?? []).map((phase) => ({
      id: phase.id,
      label: phaseLabel(phase.id),
      rules: phase.rules.map((rule) => describeRule(rule, balance)),
    })),
    instruments: (spec.instruments ?? []).map((item) => ({
      symbol: item.symbol,
      feeText: formatBps(item.feeBps ?? 0),
      slippageText: formatBps(item.slippageBps ?? 0),
      leverageText: item.maxLeverage ? `${item.maxLeverage}배` : '—',
    })),
  };
}

// Transparency page ------------------------------------------------------------------
//
// `GET /api/v2/stats/public`. 서버는 계정이 5개 미만인 상품에서 `smallSample: true`와
// 함께 **모든 수치를 null**로 보낸다(개인 식별 방지, data/analysis/season-stats.js의
// minCell 원칙). 화면은 그 null을 그대로 "아직 공개할 표본이 없습니다"로 그린다.
// 없는 숫자를 0으로 바꿔 그리지 않는다 — 0건과 "공개하지 않음"은 다른 사실이다.

export const STATS_OFFLINE_NOTICE = '서버에 연결할 수 없어 공개 통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
export const STATS_EMPTY_TEXT = '아직 공개할 표본이 없습니다';
export const SMALL_SAMPLE_REASON = '계정이 5개 미만인 상품은 특정 개인의 결과가 드러날 수 있어 수치를 공개하지 않습니다.';

const countText = (value) => (Number.isInteger(value) && value >= 0 ? `${value}개` : '—');

export function publicStatsView(payload) {
  const rows = (payload?.programs ?? []).map((item) => {
    const small = item.smallSample !== false;
    const passRate = item.passRateBps;
    return {
      code: item.program,
      version: item.version,
      name: programName(item.program),
      versionText: `규칙 버전 v${item.version}`,
      rulesHref: rulesHref(item.program, item.version),
      small,
      accountsText: small ? STATS_EMPTY_TEXT : countText(item.accounts),
      tradedText: small ? '—' : countText(item.traded),
      runningText: small ? '—' : countText(item.running),
      passedText: small ? '—' : countText(item.passed),
      breachedText: small ? '—' : countText(item.breached),
      expiredText: small ? '—' : countText(item.expired),
      // 종료된 계정이 없으면 서버가 null을 준다. 분모가 0인 비율을 지어내지 않는다.
      passRateText: small || !Number.isInteger(passRate) ? '—' : formatBps(passRate),
    };
  });
  return {
    generatedAtText: payload?.generatedAt ? formatTimestamp(payload.generatedAt) : null,
    rows,
    shown: rows.filter((row) => !row.small).length,
  };
}
