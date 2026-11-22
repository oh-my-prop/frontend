// Display logic for verdicts, appeals and two-factor setup. No DOM here, so it
// can be tested under node.

import { formatCents, formatTimestamp } from './format.js';

export const ADVERSE = new Set(['breached', 'paused', 'expired']);
const VERDICT_TITLE = {
  breached: '규칙 위반으로 계정이 종료됐습니다',
  paused: '오늘은 거래가 정지됐습니다',
  expired: '기간이 지나 계정이 종료됐습니다',
};
const RULE_KIND = {
  daily_loss: '일일 손실 한도',
  max_loss_static: '최대 손실 한도',
  max_loss_trailing: '추적형 최대 손실 한도',
  inactivity: '미거래 기간',
  max_position: '포지션 크기 한도',
};

// The verdict that ended or paused the account most recently, if any.
export function adverseVerdict(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === 'verdict' && ADVERSE.has(events[i].verdict)) return events[i];
  }
  return null;
}

// Facts shown on the verdict card: what rule, what line, what was observed, when,
// and which logged event is the evidence (03 §4.2 판정 근거 공개).
export function verdictFacts(event, rules = []) {
  const rule = rules.find((item) => item.id === event.ruleId);
  const kind = event.result?.kind ?? rule?.kind;
  const facts = [{ label: '규칙', value: `${RULE_KIND[kind] ?? kind ?? '—'}${event.ruleId ? ` (${event.ruleId})` : ''}` }];
  if (event.result?.thresholdCents !== undefined) facts.push({ label: '한도선', value: formatCents(event.result.thresholdCents) });
  if (event.result?.observedCents !== undefined) facts.push({ label: '그때 에쿼티', value: formatCents(event.result.observedCents) });
  if (event.result?.threshold !== undefined && event.result?.thresholdCents === undefined) facts.push({ label: '기준', value: `${event.result.threshold}일` });
  if (event.result?.observed !== undefined && event.result?.observedCents === undefined) facts.push({ label: '관측', value: `${event.result.observed}일` });
  facts.push({ label: '판정 시각', value: formatTimestamp(event.ts) });
  facts.push({ label: '근거 기록', value: `#${event.seq}` });
  return { title: VERDICT_TITLE[event.verdict] ?? '판정', facts };
}

export function appealStatus(appeal) {
  if (!appeal) return null;
  if (appeal.status === 'open') return { tone: 'info', text: `이의 제기 접수됨 (${formatTimestamp(appeal.createdAt)}). 검토 결과가 나오면 여기에 표시됩니다.` };
  if (appeal.status === 'upheld') return { tone: 'warn', text: `판정 유지 — ${appeal.decisionNote}` };
  return {
    tone: 'ok',
    text: `판정 번복 — ${appeal.decisionNote}${appeal.reissuedAccountId ? ` 같은 상품의 새 계정(#${appeal.reissuedAccountId})이 발급됐습니다.` : ''}`,
  };
}

export const appealReasonOk = (text) => {
  const length = [...String(text).trim()].length;
  return length >= 10 && length <= 2000;
};

// "JBSWY3DPEHPK3PXP..." → "JBSW Y3DP EHPK 3PXP ..." for typing into an authenticator.
export function groupSecret(secret) {
  return String(secret).replace(/(.{4})(?=.)/g, '$1 ');
}
