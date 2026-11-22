// Pure geometry for the candle chart: which bars fit, price → y, nice axis ticks.
//
// Prices arrive as decimal strings from the API. The chart converts them to
// Number for drawing only; nothing here feeds an order or a rule check, so
// floating point is acceptable (labels are re-rounded to the instrument's decimals).

export const PAD = { top: 12, right: 72, bottom: 24, left: 8 };
const MIN_SPACING = 5;
const MAX_SPACING = 14;

export function parseCandles(candles) {
  return candles.map((bar) => ({ t: Date.parse(bar.t), o: Number(bar.o), h: Number(bar.h), l: Number(bar.l), c: Number(bar.c), n: bar.n, raw: bar }));
}

// Step of 1, 2 or 5 × 10^k that splits `range` into about `count` parts.
export function niceStep(range, count = 5) {
  if (!(range > 0)) return 1;
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

export function priceTicks(min, max, count = 5) {
  const step = niceStep(max - min, count);
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

// Lay out the newest bars that fit `width`, scaled to their own high/low.
export function buildLayout(bars, width, height, pad = PAD) {
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = Math.max(0, height - pad.top - pad.bottom);
  const spacing = bars.length ? Math.max(MIN_SPACING, Math.min(MAX_SPACING, plotW / bars.length)) : MAX_SPACING;
  const fit = Math.max(1, Math.floor(plotW / spacing));
  const visible = bars.slice(-fit);
  let min = Math.min(...visible.map((bar) => bar.l));
  let max = Math.max(...visible.map((bar) => bar.h));
  if (!Number.isFinite(min)) [min, max] = [0, 1];
  if (max === min) {
    const half = Math.abs(max) * 0.0005 || 0.5;
    [min, max] = [min - half, max + half];
  }
  const margin = (max - min) * 0.08;
  min -= margin;
  max += margin;
  // Bars are right-aligned so the newest one always sits next to the price axis.
  const right = pad.left + plotW;
  const x = (index) => right - (visible.length - index - 0.5) * spacing;
  const y = (price) => pad.top + ((max - price) / (max - min)) * plotH;
  const priceAt = (py) => max - ((py - pad.top) / plotH) * (max - min);
  const indexAt = (px) => {
    const index = Math.round(visible.length - 0.5 - (right - px) / spacing);
    return index >= 0 && index < visible.length ? index : -1;
  };
  return {
    visible, spacing, bodyWidth: Math.max(1, Math.floor(spacing * 0.7)), min, max, x, y, priceAt, indexAt,
    plot: { left: pad.left, top: pad.top, right, bottom: pad.top + plotH, width: plotW, height: plotH },
    ticks: priceTicks(min, max, Math.max(2, Math.round(plotH / 48))),
  };
}

// Indices of bars that get a time label: on round minutes, at least `minGapPx` apart.
export function timeLabelIndices(visible, spacing, minGapPx = 64) {
  const everyMinutes = [1, 2, 5, 10, 15, 30, 60, 120, 240].find((m) => m * spacing >= minGapPx) ?? 240;
  const out = [];
  visible.forEach((bar, index) => {
    if (Math.floor(bar.t / 60000) % everyMinutes === 0) out.push(index);
  });
  return out;
}

export function clockLabel(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Merge freshly fetched bars (same or newer minutes) into the current list.
// The API returns every bar from `since`, so the last stored bar is replaced
// by its updated version rather than duplicated.
export function mergeCandles(current, fresh, max = 1440) {
  if (fresh.length === 0) return current;
  const from = Date.parse(fresh[0].t);
  return [...current.filter((bar) => Date.parse(bar.t) < from), ...fresh].slice(-max);
}

// Bid/ask midpoint as text with the instrument's decimals, rounded down
// (the same rounding the server uses for candles). Integer math on the digits.
export function midText(bid, ask, decimals) {
  const ticks = (text) => {
    const [whole, fraction = ''] = String(text).split('.');
    return BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals));
  };
  const mid = ((ticks(bid) + ticks(ask)) / 2n).toString().padStart(decimals + 1, '0');
  return decimals === 0 ? mid : `${mid.slice(0, -decimals)}.${mid.slice(-decimals)}`;
}
