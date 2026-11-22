// Canvas candle chart, no dependencies.
//
//   const chart = createCandleChart({ canvas, readout });
//   chart.update({ candles, decimals, lastPrice, lines });
//
// - candles: API bars { t, o, h, l, c, n } (strings), oldest first
// - lastPrice: current mid as a string, drawn as a dashed line with a label
// - lines: [{ price, label, kind }] for the account's entry price and resting orders
// The OHLC of the bar under the pointer goes to `readout` (a DOM node), not into
// the canvas, so screen readers and text selection keep working.

import { buildLayout, clockLabel, parseCandles, timeLabelIndices } from './chart-scale.js';

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function createCandleChart({ canvas, readout }) {
  const ctx = canvas.getContext('2d');
  let data = { bars: [], decimals: 2, lastPrice: null, lines: [] };
  let layout = null;
  let hover = null; // { x, y }
  let frame = 0;

  const theme = () => ({
    up: css('--buy', '#4fd18b'),
    down: css('--sell', '#f26d6d'),
    grid: css('--line', '#24332e'),
    text: css('--muted', '#8ea39a'),
    strong: css('--text', '#e8f0eb'),
    accent: css('--accent', '#b8ed78'),
    warn: css('--warn', '#f2b84b'),
    info: css('--info', '#6cc3e0'),
    surface: css('--surface-2', '#1a2522'),
  });

  const fmt = (value) => value.toFixed(data.decimals);

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function tag(text, y, fill, ink, plot) {
    ctx.font = '600 11px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 10;
    const top = Math.min(Math.max(y - 9, plot.top), plot.bottom - 18);
    ctx.fillStyle = fill;
    ctx.fillRect(plot.right + 2, top, w, 18);
    ctx.fillStyle = ink;
    ctx.fillText(text, plot.right + 7, top + 13);
  }

  function draw() {
    frame = 0;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const colors = theme();
    layout = buildLayout(data.bars, width, height);
    const { plot, visible, x, y, bodyWidth } = layout;

    // Grid and price axis.
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (const tick of layout.ticks) {
      const py = Math.round(y(tick)) + 0.5;
      ctx.strokeStyle = colors.grid;
      ctx.beginPath();
      ctx.moveTo(plot.left, py);
      ctx.lineTo(plot.right, py);
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.fillText(fmt(tick), plot.right + 7, py + 4);
    }
    // Time axis.
    for (const index of timeLabelIndices(visible, layout.spacing)) {
      const label = clockLabel(visible[index].t);
      const px = x(index);
      ctx.fillStyle = colors.text;
      ctx.fillText(label, px - ctx.measureText(label).width / 2, plot.bottom + 16);
    }

    if (visible.length === 0) {
      ctx.fillStyle = colors.text;
      ctx.font = '13px system-ui, sans-serif';
      const message = '아직 쌓인 1분 봉이 없습니다. 시세가 들어오면 그려집니다.';
      ctx.fillText(message, plot.left + (plot.width - ctx.measureText(message).width) / 2, plot.top + plot.height / 2);
    }

    // Candles.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.left, plot.top, plot.width, plot.height);
    ctx.clip();
    visible.forEach((bar, index) => {
      const color = bar.c >= bar.o ? colors.up : colors.down;
      const cx = Math.round(x(index)) + 0.5;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, y(bar.h));
      ctx.lineTo(cx, y(bar.l));
      ctx.stroke();
      const top = y(Math.max(bar.o, bar.c));
      const bodyHeight = Math.max(1, y(Math.min(bar.o, bar.c)) - top);
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(cx - bodyWidth / 2), top, bodyWidth, bodyHeight);
    });

    // Account lines (entry, resting orders) then the live price.
    const lineColor = { entry: colors.info, stop: colors.down, take: colors.up, order: colors.warn };
    const tags = [];
    for (const line of data.lines) {
      const value = Number(line.price);
      if (!Number.isFinite(value)) continue;
      const py = Math.round(y(value)) + 0.5;
      ctx.strokeStyle = lineColor[line.kind] ?? colors.warn;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(plot.left, py);
      ctx.lineTo(plot.right, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = lineColor[line.kind] ?? colors.warn;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(line.label, plot.left + 6, Math.min(Math.max(py - 4, plot.top + 11), plot.bottom - 4));
      tags.push([line.price, py, lineColor[line.kind] ?? colors.warn]);
    }
    const last = data.lastPrice === null ? null : Number(data.lastPrice);
    if (Number.isFinite(last)) {
      const py = Math.round(y(last)) + 0.5;
      ctx.strokeStyle = colors.accent;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(plot.left, py);
      ctx.lineTo(plot.right, py);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    for (const [price, py, color] of tags) tag(String(price), py, color, '#0d1412', plot);
    if (Number.isFinite(last)) tag(data.lastPrice, y(last), colors.accent, '#10200f', plot);

    // Crosshair.
    const index = hover ? layout.indexAt(hover.x) : -1;
    if (hover && hover.y >= plot.top && hover.y <= plot.bottom && hover.x <= plot.right) {
      ctx.strokeStyle = colors.text;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      if (index >= 0) {
        const cx = Math.round(x(index)) + 0.5;
        ctx.moveTo(cx, plot.top);
        ctx.lineTo(cx, plot.bottom);
      }
      ctx.moveTo(plot.left, Math.round(hover.y) + 0.5);
      ctx.lineTo(plot.right, Math.round(hover.y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      tag(fmt(layout.priceAt(hover.y)), hover.y, colors.surface, colors.strong, plot);
    }
    renderReadout(index >= 0 ? visible[index] : visible.at(-1));
  }

  function renderReadout(bar) {
    if (!readout) return;
    if (!bar) {
      readout.textContent = '1분 봉 · 매수·매도 호가의 중간값 기준';
      return;
    }
    const change = bar.c - bar.o;
    const sign = change > 0 ? '+' : change < 0 ? '−' : '';
    readout.textContent = `${clockLabel(bar.t)}  시 ${bar.raw.o}  고 ${bar.raw.h}  저 ${bar.raw.l}  종 ${bar.raw.c}  (${sign}${fmt(Math.abs(change))})`;
    readout.dataset.dir = String(Math.sign(change));
  }

  const onMove = (event) => {
    const rect = canvas.getBoundingClientRect();
    hover = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    schedule();
  };
  const onLeave = () => {
    hover = null;
    schedule();
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resize?.observe(canvas);

  return {
    update({ candles, decimals, lastPrice = null, lines = [] }) {
      data = { bars: parseCandles(candles), decimals, lastPrice, lines };
      const newest = candles.at(-1);
      canvas.setAttribute('aria-label', newest
        ? `1분 봉 차트, 최근 ${candles.length}개. 마지막 봉 시가 ${newest.o}, 종가 ${newest.c}${lastPrice ? `, 현재 ${lastPrice}` : ''}`
        : '1분 봉 차트, 아직 데이터 없음');
      schedule();
    },
    destroy() {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    },
  };
}
