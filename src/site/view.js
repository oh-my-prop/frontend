// Pure view models for the public pages (home, leaderboard, rules). Inputs are
// the plain API payloads; outputs are plain data, so this is testable in Node.
// Rule wording comes from src/trader/view.js so every page says the same thing.

import { formatBps, formatCents } from '../trader/format.js';
import { describeRule, phaseLabel, programName, programPitch, ruleHighlights } from '../trader/view.js';

export const SIM_NOTICE = '시뮬레이션 계정 — 실제 시장에 주문이 전달되지 않습니다';
export const PAID_NOTICE = '준비 중 — 유료 평가는 법률 검토 후 제공';
export const OFFLINE_NOTICE = '서버에 연결할 수 없어 상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const rulesHref = (code, version) => `/rules.html?program=${encodeURIComponent(code)}&version=${version}`;
export const leaderboardHref = (code, version) => `/leaderboard.html?program=${encodeURIComponent(code)}&version=${version}`;

// Free programs first, then by code, so the order is stable whatever the API returns.
export function sortPrograms(programs) {
  return [...programs].sort((a, b) => Number(Boolean(b.free)) - Number(Boolean(a.free)) || String(a.program).localeCompare(String(b.program)));
}

// One comparison card. `spec` is the full program spec when it could be loaded.
// Paid programs never show a price or a reward figure: only the rules and the notice.
export function programCard(program, spec) {
  const firstPhase = spec?.phases?.[0];
  const free = Boolean(program.free);
  let status;
  if (!free) status = { kind: 'soon', symbol: '◷', text: PAID_NOTICE };
  else if (program.available) status = { kind: 'open', symbol: '✓', text: '참가 가능 · 보상 없음(순위 기록만)' };
  else status = { kind: 'closed', symbol: '–', text: '현재 열려 있는 시즌이 없습니다' };
  return {
    code: program.program,
    version: program.version,
    free,
    name: programName(program.program),
    pitch: programPitch(program.program, program.description ?? ''),
    kindText: free ? '무료 시즌' : '유료 평가(준비 중)',
    balanceText: `가상 잔고 ${formatCents(program.initialBalanceCents ?? spec?.initialBalanceCents ?? 0)}`,
    phasesText: (program.phases ?? spec?.phases?.map((phase) => phase.id) ?? []).map(phaseLabel).join(' → '),
    chips: firstPhase ? ruleHighlights(firstPhase.rules, spec.initialBalanceCents) : [],
    status,
    canJoin: free && Boolean(program.available),
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
