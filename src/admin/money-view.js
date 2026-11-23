// 운영 돈 화면의 표시 규칙 (GET /api/v2/admin/money). DOM 없이 테스트한다.
//
// 이 화면이 답해야 하는 질문은 하나다: "결제했는데 계정이 없다"는 문의가 왔을 때
// 어디까지 진행됐는가. 그래서 주문·원장·준비금·아웃박스를 한 자리에 모은다.
//
// 두 가지를 조심한다.
//  1. 여기 금액은 전부 **원화**다. 거래 계정의 가상 USD와 섞이면 안 된다
//     (제품 명세 §5). 금액은 formatKrw로만 찍고 '원'을 붙인다.
//  2. 미정산 저널(합이 0이 아닌 분개)과 데드레터는 0이 아니면 그 자체로 사고다.
//     숫자만 두면 아무도 보지 않으므로 경고로 올린다.

export const LEDGER_LABELS = {
  'cash:pg_clearing': '정산 대기 현금',
  'cash:bank': '은행 현금',
  'cash:payout_reserve': '지급 준비금',
  'revenue:evaluation_fee': '평가 수수료 수익',
  'contra:fee_refund': '수수료 환입(철회)',
  'expense:payout_reward': '보상 지급 비용',
  'expense:pg_fee': '결제 수수료 비용',
  'liability:payout_payable': '미지급 보상(부채)',
  'liability:withholding_tax': '원천징수 예수금(부채)',
};

// backend/src/money/ledger.js:16-26과 같은 순서. 서버가 계정과목을 추가하면
// 모르는 이름이라도 빠뜨리지 않고 뒤에 붙인다.
const ORDER = Object.keys(LEDGER_LABELS);

export function ledgerRows(balances = {}) {
  const names = Object.keys(balances);
  const known = ORDER.filter((name) => names.includes(name));
  const extra = names.filter((name) => !ORDER.includes(name)).sort();
  return [...known, ...extra].map((account) => ({
    account,
    label: LEDGER_LABELS[account] ?? account,
    amountKrw: balances[account] ?? 0,
  }));
}

/**
 * 준비금 상태. ratio는 서버에서 Infinity로 올 수 있다(준비금 0인데 빚이 있을 때,
 * backend/src/money/reserve.js:63). 그대로 찍으면 "Infinity%"가 되므로 말로 쓴다.
 */
export function reserveView(reserve) {
  if (!reserve) return { ratioText: '—', tone: 'info', halted: false, help: '준비금 정보를 받지 못했습니다.' };
  const halted = Boolean(reserve.halted);
  const ratio = reserve.ratio;
  let ratioText;
  if (!Number.isFinite(ratio)) ratioText = reserve.outstandingKrw > 0 ? '준비금 없음' : '—';
  else ratioText = `${(ratio * 100).toFixed(1)}%`;
  return {
    ratioText,
    tone: halted ? 'danger' : ratio >= 0.8 ? 'warning' : 'ok',
    halted,
    help: halted
      ? '미지급 추정액이 준비금을 넘어 신규 펀딩 승급이 중단됐습니다. 이미 승인된 지급은 그대로 진행됩니다.'
      : '미지급 추정액 ÷ 준비금. 소진율이 1에 닿으면 신규 펀딩 승급이 자동으로 멈춥니다.',
  };
}

/** 0이 아니면 사람이 봐야 하는 것들. 빈 배열이면 정상이다. */
export function moneyAlerts({ unbalancedJournals = [], outbox = {} } = {}) {
  const alerts = [];
  if (unbalancedJournals.length > 0) {
    alerts.push({
      kind: 'unbalanced',
      tone: 'danger',
      text: `합이 0이 아닌 분개 ${unbalancedJournals.length}건 — 원장이 맞지 않습니다. 즉시 확인이 필요합니다.`,
      detail: unbalancedJournals.map((row) => `${row.journalId} (${row.total})`).join(', '),
    });
  }
  if ((outbox.deadLetters ?? 0) > 0) {
    alerts.push({
      kind: 'dead_letters',
      tone: 'danger',
      text: `재시도를 포기한 아웃박스 작업 ${outbox.deadLetters}건 — 결제 취소나 통지가 전달되지 않았습니다.`,
      detail: '',
    });
  }
  return alerts;
}

export const ORDER_STATUS_FILTERS = [
  { value: '', label: '전체' },
  { value: 'created', label: '결제 대기' },
  { value: 'confirming', label: '결제 확인 중' },
  { value: 'unknown', label: '결과 미확인' },
  { value: 'paid', label: '결제 완료' },
  { value: 'failed', label: '결제 실패' },
  { value: 'void_pending', label: '취소 처리 중' },
  { value: 'voided', label: '취소됨' },
  { value: 'refund_pending', label: '철회 처리 중' },
  { value: 'refunded', label: '철회 완료' },
];

/**
 * 주문 한 줄. "결제됐는데 계정이 없다"가 한눈에 보여야 하므로 그 조합만 따로
 * 표시한다(사용자 화면과 같은 규칙: backend/src/money/payments.js의 paid+account_id).
 */
export function moneyOrderRow(order) {
  const paidWithoutAccount = order.status === 'paid' && !order.accountId;
  return {
    orderId: order.orderId,
    status: order.status,
    amountKrw: order.amountKrw ?? 0,
    userId: order.userId ?? null,
    accountId: order.accountId ?? null,
    accountText: order.accountId ? `#${order.accountId}` : paidWithoutAccount ? '없음(확인 필요)' : '—',
    productText: order.program ? `${order.program} v${order.version}` : '—',
    failureCode: order.failureCode ?? null,
    warn: paidWithoutAccount,
    createdAt: order.createdAt ?? null,
    updatedAt: order.updatedAt ?? null,
  };
}
