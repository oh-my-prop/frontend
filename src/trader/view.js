// Pure view models for the trader dashboard. Everything here takes plain data
// from the API (program spec, account snapshot, events) and returns plain data,
// so it can be tested without a browser. The server's rule results are the
// authority; these functions only describe and arrange them.

import { WARNING_LEVELS } from '../rules/limits.js';
import { formatBps, formatCents } from './format.js';

const BPS = 10000n;
const LOSS_KINDS = new Set(['daily_loss', 'max_loss_static', 'max_loss_trailing']);

const BASIS_TEXT = {
  balance: '거래일 시작 잔고',
  equity: '거래일 시작 에쿼티',
  max_balance_equity: '거래일 시작 잔고와 에쿼티 중 큰 값',
};

const PHASE_TEXT = { season: '시즌', eval_1: '평가 1단계', eval_2: '평가 2단계', funded: '펀딩' };
export const phaseLabel = (phase) => PHASE_TEXT[phase] ?? phase;

function allowanceCents(rule, initialBalanceCents) {
  if (rule.limitCents != null) return BigInt(rule.limitCents);
  return (BigInt(initialBalanceCents) * BigInt(rule.limitBps)) / BPS;
}

function amountText(rule, initialBalanceCents) {
  const amount = formatCents(allowanceCents(rule, initialBalanceCents));
  return rule.limitCents != null ? amount : `${formatBps(rule.limitBps)} (${amount})`;
}

// One Korean sentence per rule, generated from the spec so the explanation can
// never drift from what the engine enforces.
export function describeRule(rule, initialBalanceCents) {
  switch (rule.kind) {
    case 'daily_loss':
      return {
        title: `일일 손실 한도 ${amountText(rule, initialBalanceCents)}`,
        detail: `기준: ${BASIS_TEXT[rule.basis]}. 에쿼티가 한도선에 닿으면 ${rule.enforcement === 'pause' ? '모든 포지션을 청산하고 다음 거래일까지 거래가 정지됩니다' : '계정이 종료됩니다'}.`,
      };
    case 'max_loss_static':
      return { title: `최대 손실 한도 ${amountText(rule, initialBalanceCents)}`, detail: '초기 잔고 기준으로 고정된 선입니다. 닿으면 계정이 종료됩니다.' };
    case 'max_loss_trailing': {
      const lock = rule.lockAtInitial
        ? ` 한도선이 초기 잔고${rule.lockOffsetCents ? ` + ${formatCents(rule.lockOffsetCents)}` : ''}에 닿으면 더 오르지 않습니다.`
        : '';
      return {
        title: `추적형 최대 손실 ${amountText(rule, initialBalanceCents)}`,
        detail: `${rule.mode === 'end_of_day' ? '거래일 마감 에쿼티' : '실시간 에쿼티'}의 최고점을 따라 한도선이 올라갑니다.${lock} 닿으면 계정이 종료됩니다.`,
      };
    }
    case 'profit_target':
      return { title: `수익 목표 ${formatBps(rule.targetBps)}`, detail: '포지션이 모두 청산된 상태에서 잔고가 목표선 이상이어야 합니다.' };
    case 'min_trading_days':
      return { title: `최소 거래일 ${rule.days}일`, detail: '체결이 한 번 이상 있는 거래일만 셉니다.' };
    case 'min_profitable_days': {
      const threshold = rule.minDayProfitCents != null ? formatCents(rule.minDayProfitCents) : `초기 잔고의 ${formatBps(rule.minDayProfitBps)}`;
      return { title: `수익일 ${rule.days}일`, detail: `마감된 거래일 중 순이익이 ${threshold} 이상인 날만 셉니다.` };
    }
    case 'inactivity':
      return { title: `무거래 ${rule.days}일 시 만료`, detail: '체결 없이 지나간 거래일이 이어지면 계정이 만료됩니다.' };
    case 'consistency':
      return {
        title: `일관성: 최고 수익일 ≤ 총수익의 ${formatBps(rule.maxDayShareBps)}`,
        detail: rule.scope === 'phase' ? '넘으면 실패가 아니라, 비율을 맞출 때까지 단계 통과가 보류됩니다.' : '넘으면 보상 요청이 보류됩니다.',
      };
    case 'flat_at_close':
      return { title: '거래일 마감 전 청산', detail: '마감 시각에 남은 포지션은 자동으로 청산됩니다(위반 아님).' };
    case 'max_position': {
      const parts = [];
      if (rule.maxNotionalCents != null) parts.push(`명목 금액 ${formatCents(rule.maxNotionalCents)}`);
      for (const [symbol, qty] of Object.entries(rule.maxQtyBySymbol ?? {})) parts.push(`${symbol} ${qty}`);
      return { title: '최대 포지션', detail: `${parts.join(', ')}까지 보유할 수 있습니다. 넘는 주문은 접수되지 않습니다.` };
    }
    default:
      return { title: rule.kind, detail: '' };
  }
}

function warningFor(remaining, allowance) {
  if (remaining <= 0n) return 'reached';
  const share = allowance > 0n ? (remaining * BPS) / allowance : 0n;
  return WARNING_LEVELS.find((entry) => share <= entry.remainingBps)?.level ?? 'normal';
}

// Loss-limit cards from the server's latest rule results.
export function limitCards(phaseRules, results, initialBalanceCents) {
  const byId = new Map(results.map((result) => [result.ruleId, result]));
  const cards = phaseRules
    .map((rule, index) => ({ rule, id: rule.id ?? `${rule.kind}#${index}` }))
    .filter(({ rule }) => LOSS_KINDS.has(rule.kind))
    .map(({ rule, id }) => {
      const result = byId.get(id);
      if (!result) return null;
      const remaining = BigInt(result.observedCents) - BigInt(result.thresholdCents);
      return {
        ruleId: id,
        title: describeRule(rule, initialBalanceCents).title,
        lineCents: result.thresholdCents,
        remainingCents: Number(remaining),
        warning: warningFor(remaining, allowanceCents(rule, initialBalanceCents)),
        consequence: rule.kind === 'daily_loss' && rule.enforcement === 'pause' ? 'pause' : 'breach',
      };
    })
    .filter(Boolean);
  const nearest = cards.reduce((best, card) => (best === null || card.remainingCents < best.remainingCents ? card : best), null);
  return cards.map((card) => ({ ...card, nearest: card.ruleId === nearest?.ruleId }));
}

const clampPercent = (part, whole) => (whole <= 0 ? 100 : Math.max(0, Math.min(100, Math.floor((part * 100) / whole))));

// Objective progress (target, trading days, profitable days, consistency).
export function objectiveCards(phaseRules, results, initialBalanceCents) {
  const byId = new Map(results.map((result) => [result.ruleId, result]));
  const cards = [];
  phaseRules.forEach((rule, index) => {
    const result = byId.get(rule.id ?? `${rule.kind}#${index}`);
    if (!result) return;
    const { title } = describeRule(rule, initialBalanceCents);
    if (rule.kind === 'profit_target') {
      const gained = result.observedCents - initialBalanceCents;
      const needed = result.thresholdCents - initialBalanceCents;
      cards.push({ ruleId: result.ruleId, title, met: result.outcome === 'objective_met', percent: clampPercent(gained, needed), text: `${formatCents(gained)} / ${formatCents(needed)}` });
    } else if (rule.kind === 'min_trading_days' || rule.kind === 'min_profitable_days') {
      cards.push({ ruleId: result.ruleId, title, met: result.outcome === 'objective_met', percent: clampPercent(result.observed, result.threshold), text: `${result.observed} / ${result.threshold}일` });
    } else if (rule.kind === 'consistency') {
      const held = result.outcome === 'hold';
      const text = result.note === 'no_profit'
        ? '아직 순이익이 없어 비율을 계산할 수 없습니다.'
        : `최고 수익일 비중 ${formatBps(result.shareBps)} / 상한 ${formatBps(rule.maxDayShareBps)}${held ? ` · 총수익 ${formatCents(result.requiredProfitCents)}이 되면 충족` : ''}`;
      cards.push({ ruleId: result.ruleId, title, met: !held, percent: held ? 0 : 100, text });
    }
  });
  return cards;
}

function decimalToUnits(text, decimals) {
  if (typeof text !== 'string' || !/^\d+(\.\d+)?$/.test(text.trim())) return null;
  const [whole, fraction = ''] = text.trim().split('.');
  if (fraction.length > decimals) return null;
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

const ceilDiv = (a, b) => (a % b === 0n ? a / b : a / b + (a > 0n ? 1n : 0n));

// Estimated loss if the stop is hit, using the same conventions as the server
// (stop fills move against the trader by the slippage; both fills pay the fee).
// A gap can still make the real loss larger; the UI must say so.
export function stopLossPreview({ instrument, side, qty, entryPrice, stopLoss, dailyRemainingCents }) {
  if (!instrument || !stopLoss) return { available: false, reason: '손절가가 없으면 손실 상한을 계산할 수 없습니다.' };
  const q = decimalToUnits(qty, instrument.qtyDecimals);
  const entry = decimalToUnits(entryPrice, instrument.priceDecimals);
  const stop = decimalToUnits(stopLoss, instrument.priceDecimals);
  if (!q || !entry || !stop) return { available: false, reason: '수량과 가격을 올바르게 입력하면 계산합니다.' };
  const long = side === 'buy';
  if (long ? stop >= entry : stop <= entry) return { available: false, reason: '손절가가 진입가보다 불리한 쪽에 있어야 합니다.' };
  const slip = BigInt(instrument.slippageBps ?? 0);
  const fill = long ? (stop * (BPS - slip)) / BPS : ceilDiv(stop * (BPS + slip), BPS);
  const mult = BigInt(instrument.multiplier ?? 1) * 100n;
  const scale = 10n ** BigInt(instrument.priceDecimals + instrument.qtyDecimals);
  const fee = (price) => ceilDiv(price * q * mult * BigInt(instrument.feeBps ?? 0), scale * BPS);
  const move = long ? entry - fill : fill - entry;
  const loss = ceilDiv(move * q * mult, scale) + fee(entry) + fee(fill);
  const after = dailyRemainingCents == null ? null : BigInt(dailyRemainingCents) - loss;
  return { available: true, lossCents: Number(loss), remainingAfterCents: after == null ? null : Number(after), reachesLimit: after != null && after <= 0n };
}

export function statusBanner(account) {
  if (account.status === 'breached') return { tone: 'danger', text: '규칙 위반으로 계정이 종료됐습니다. 아래 판정 근거를 확인하세요.' };
  if (account.status === 'expired') return { tone: 'danger', text: '거래가 없는 기간이 길어 계정이 만료됐습니다.' };
  if (account.status === 'passed') return { tone: 'success', text: '이 단계를 통과했습니다. 다음 단계 계정은 계정 목록에서 확인하세요.' };
  if (account.paused) return { tone: 'warning', text: '일일 손실 한도에 닿아 다음 거래일까지 거래가 정지됐습니다.' };
  return { tone: 'normal', text: '거래 가능' };
}

const SIDE_TEXT = { buy: '매수', sell: '매도' };
const TYPE_TEXT = { market: '시장가', limit: '지정가', stop: '스톱' };
const CANCEL_TEXT = { user: '직접 취소', oco: '짝 주문 체결', position_flat: '포지션 청산', breached: '위반 청산', expired: '만료 청산', paused: '정지 청산', session_close: '마감 청산' };
const FILL_TEXT = { market: '', limit: ' (지정가 도달)', limit_marketable: ' (즉시 체결)', stop: ' (스톱 발동)', forced_breached: ' (위반 강제 청산)', forced_paused: ' (정지 강제 청산)', forced_expired: ' (만료 강제 청산)', forced_session_close: ' (마감 강제 청산)' };
const VERDICT_TEXT = { breached: '규칙 위반', expired: '계정 만료', paused: '당일 거래 정지', phase_passed: '단계 통과' };

// One line per engine event for the activity log.
export function describeEvent(event) {
  switch (event.type) {
    case 'account_opened':
      return `계정 개설 · 초기 잔고 ${formatCents(event.initialBalanceCents)}`;
    case 'order_placed':
      return `${event.forced ? '강제 ' : ''}주문 접수 · ${event.symbol} ${SIDE_TEXT[event.side]} ${event.qty} ${TYPE_TEXT[event.orderType]}${event.price ? ` @ ${event.price}` : ''}`;
    case 'order_filled':
      return `체결 · ${event.symbol} ${SIDE_TEXT[event.side]} ${event.qty} @ ${event.price}${FILL_TEXT[event.reason] ?? ''} · 확정 손익 ${formatCents(event.realizedPnlCents)} (수수료 ${formatCents(event.feeCents)} 포함)`;
    case 'order_cancelled':
      return `주문 취소 · ${event.orderId} (${CANCEL_TEXT[event.reason] ?? event.reason})`;
    case 'verdict':
      return `판정 · ${VERDICT_TEXT[event.verdict] ?? event.verdict}${event.result ? ` · 기준 ${formatCents(event.result.thresholdCents)}, 관측 ${formatCents(event.result.observedCents)}` : ''}`;
    case 'trading_day_closed':
      return `거래일 마감 · 잔고 ${formatCents(event.balanceCents)}, 에쿼티 ${formatCents(event.equityCents)}`;
    case 'market_status':
      return `시세 상태 · ${event.symbol} ${event.status}`;
    case 'quote_rejected':
      return `비정상 시세 무시 · ${event.symbol}`;
    default:
      return event.type;
  }
}
