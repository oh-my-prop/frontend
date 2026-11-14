// Display-side loss-limit calculator for the trader dashboard.
//
// The server's rule engine is the authority on breaches. This module exists so the
// dashboard can redraw the limit cards on every quote without a round trip, and it
// is implemented independently of the backend on purpose: both sides run the
// shared fixtures in test/fixtures/rules and must agree to the cent. When the two
// disagree the dashboard shows the server's number (PROP-PRODUCT-SPEC §3).
//
// Amounts are BigInt cents, rates are basis points (500 = 5%).

const BPS = 10000n;
const LOSS_KINDS = new Set(['daily_loss', 'max_loss_static', 'max_loss_trailing']);

// Warning thresholds as a share of the rule's full allowance (spec §2.2).
export const WARNING_LEVELS = Object.freeze([
  { level: 'critical', remainingBps: 1000n },
  { level: 'danger', remainingBps: 2500n },
  { level: 'caution', remainingBps: 5000n },
]);

const big = (value) => (typeof value === 'bigint' ? value : BigInt(value));

// ceil(a / b) for b > 0: a loss line is rounded up so the remaining room is never overstated.
function ceilDiv(a, b) {
  const q = a / b;
  return a % b !== 0n && a > 0n ? q + 1n : q;
}

const lineFrom = (base, initial, limitBps) => ceilDiv(base * BPS - initial * limitBps, BPS);

export function createTracker({ initialBalanceCents, rules }) {
  const initial = big(initialBalanceCents);
  return {
    initial,
    rules: rules.filter((rule) => LOSS_KINDS.has(rule.kind)).map((rule, index) => ({ ...rule, id: rule.id ?? `${rule.kind}#${index}`, limitBps: big(rule.limitBps) })),
    balance: initial,
    equity: initial,
    dayStartBalance: initial,
    dayStartEquity: initial,
    peaks: {},
    locked: {},
  };
}

// Apply one account event (same shape the server streams) and return a new tracker.
export function applyEvent(tracker, event) {
  const next = { ...tracker, peaks: { ...tracker.peaks }, locked: { ...tracker.locked } };
  if (event.realizedPnlCents != null && (event.type === 'position_closed' || event.type === 'position_opened')) {
    next.balance += big(event.realizedPnlCents);
    if (event.equityCents == null && event.type === 'position_closed' && (event.openPositions ?? 0) === 0) next.equity = next.balance;
  }
  if (event.balanceCents != null) next.balance = big(event.balanceCents);
  if (event.equityCents != null) next.equity = big(event.equityCents);

  for (const rule of next.rules) {
    if (rule.kind !== 'max_loss_trailing') continue;
    const intraday = rule.mode === 'intraday';
    if (intraday || event.type === 'trading_day_closed') {
      const peak = next.peaks[rule.id] ?? next.initial;
      next.peaks[rule.id] = next.equity > peak ? next.equity : peak;
    }
  }
  if (event.type === 'trading_day_started') {
    next.dayStartBalance = next.balance;
    next.dayStartEquity = next.equity;
  }
  if (event.type === 'trading_day_closed') {
    next.dayStartBalance = next.balance;
    next.dayStartEquity = next.equity;
  }
  return next;
}

function ruleLine(tracker, rule) {
  if (rule.kind === 'max_loss_static') return lineFrom(tracker.initial, tracker.initial, rule.limitBps);
  if (rule.kind === 'daily_loss') {
    const base = rule.basis === 'balance' ? tracker.dayStartBalance
      : rule.basis === 'equity' ? tracker.dayStartEquity
        : tracker.dayStartBalance > tracker.dayStartEquity ? tracker.dayStartBalance : tracker.dayStartEquity;
    return lineFrom(base, tracker.initial, rule.limitBps);
  }
  if (tracker.locked[rule.id]) return tracker.initial;
  const line = lineFrom(tracker.peaks[rule.id] ?? tracker.initial, tracker.initial, rule.limitBps);
  if (rule.lockAtInitial && line >= tracker.initial) {
    tracker.locked[rule.id] = true;
    return tracker.initial;
  }
  return line;
}

// Limit cards for the dashboard: line, remaining room, warning level, and which
// rule is nearest. `reached` mirrors the server convention that equality breaches.
export function limitCards(tracker) {
  const cards = tracker.rules.map((rule) => {
    const line = ruleLine(tracker, rule);
    const remaining = tracker.equity - line;
    const allowance = tracker.initial * rule.limitBps / BPS;
    const share = allowance > 0n ? (remaining * BPS) / allowance : 0n;
    const warning = remaining <= 0n ? 'reached' : WARNING_LEVELS.find((entry) => share <= entry.remainingBps)?.level ?? 'normal';
    return { ruleId: rule.id, kind: rule.kind, lineCents: line, remainingCents: remaining, reached: remaining <= 0n, warning };
  });
  const nearest = cards.reduce((best, card) => (best === null || card.remainingCents < best.remainingCents ? card : best), null);
  return { cards, nearestRuleId: nearest?.ruleId ?? null };
}
