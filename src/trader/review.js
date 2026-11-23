// Trade review for one account, computed from its engine events only. Nothing
// here is stored: it is recomputed from the same event log the server judged.
//
// Definitions (see docs/PROP-PRODUCT-SPEC.md, trade review):
// - A fill "closes" when it reduces an existing position in that symbol. Its
//   result is the fill's realizedPnlCents, which already has its own fee taken
//   out. Opening fills only cost their fee and are not counted as trades.
// - Balance path: starts at the initial balance and moves by every fill's
//   realizedPnlCents. Max drawdown is the largest (running peak − balance) on
//   that path, so it is a closed-trade figure, not intraday or unrealized loss.
// - Win rate leaves out break-even trades; with no wins or losses it is null.

const SCALE = 18; // decimal places used to compare quantities exactly

function qtyUnits(text) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(text));
  if (!match) throw new Error(`bad quantity: ${text}`);
  const fraction = (match[2] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
  return BigInt(match[1]) * 10n ** BigInt(SCALE) + BigInt(fraction);
}

// BigInt → Number only when exact; otherwise null so the UI says "계산 불가".
function safe(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function tradeReview(events) {
  const opened = events.find((event) => event.type === 'account_opened');
  const initial = BigInt(opened?.initialBalanceCents ?? 0);
  const net = new Map(); // symbol -> signed quantity units
  let balance = initial;
  let peak = initial;
  let maxDrawdown = 0n;
  let fees = 0n;
  let wins = 0;
  let losses = 0;
  let flat = 0;
  let best = null;
  let worst = null;
  let bestPnl = 0n;
  let worstPnl = 0n;
  const trades = [];

  for (const event of events) {
    if (event.type !== 'order_filled') continue;
    const signed = (event.side === 'buy' ? 1n : -1n) * qtyUnits(event.qty);
    const before = net.get(event.symbol) ?? 0n;
    net.set(event.symbol, before + signed);
    const pnl = BigInt(event.realizedPnlCents);
    fees += BigInt(event.feeCents);
    balance += pnl;
    if (balance > peak) peak = balance;
    if (peak - balance > maxDrawdown) maxDrawdown = peak - balance;

    const closes = before !== 0n && (before > 0n) !== (signed > 0n);
    if (!closes) continue;
    if (pnl > 0n) wins += 1;
    else if (pnl < 0n) losses += 1;
    else flat += 1;
    const trade = { seq: event.seq, ts: event.ts, symbol: event.symbol, side: event.side, qty: event.qty, price: event.price, reason: event.reason, pnlCents: safe(pnl), balanceCents: safe(balance) };
    trades.push(trade);
    if (pnl > bestPnl) [best, bestPnl] = [trade, pnl];
    if (pnl < worstPnl) [worst, worstPnl] = [trade, pnl];
  }

  const decided = wins + losses;
  const firstBreach = events.find((event) => event.type === 'verdict' && event.verdict === 'breached') ?? null;
  return {
    initialBalanceCents: safe(initial),
    netPnlCents: safe(balance - initial),
    feesCents: safe(fees),
    closedTrades: trades.length,
    wins,
    losses,
    flat,
    // Tenths of a percent, rounded half up: 2/3 → 667 (66.7%).
    winRateTenths: decided === 0 ? null : Math.floor((wins * 2000 + decided) / (decided * 2)),
    maxDrawdownCents: safe(maxDrawdown),
    best, // largest winning trade, or null
    worst, // largest losing trade, or null
    firstBreach: firstBreach && { seq: firstBreach.seq, ts: firstBreach.ts, ruleId: firstBreach.ruleId ?? null },
    trades,
  };
}

export function formatWinRate(tenths) {
  if (tenths === null) return '계산할 승패 거래 없음';
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}
