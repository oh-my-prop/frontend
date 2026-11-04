const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function parseMoney(value, label, signed = false) {
  if (typeof value !== 'string') {
    throw new Error(`${label}을(를) 숫자로 입력해 주세요.`);
  }
  const text = value.trim();
  const match = (signed ? /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/ : /^(\d+)(?:\.(\d{1,2}))?$/).exec(text);
  if (!match) {
    throw new Error(`${label}은(는) 소수점 둘째 자리까지의 숫자로 입력해 주세요.`);
  }
  const sign = signed ? match[1] : '';
  const whole = signed ? match[2] : match[1];
  const fraction = (signed ? match[3] : match[2]) || '';
  const digits = (whole + fraction.padEnd(2, '0')).replace(/^0+/, '') || '0';
  const maximum = MAX_SAFE_CENTS.toString();
  if (digits.length > maximum.length || (digits.length === maximum.length && digits > maximum)) {
    throw new Error(`${label}이(가) 허용 범위를 초과했습니다.`);
  }
  const cents = BigInt(digits);
  return sign === '-' ? -cents : cents;
}

function parsePercent(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    throw new Error('손실 허용률을 숫자로 입력해 주세요.');
  }
  const [whole, fraction = ''] = value.trim().split('.');
  // Strip leading zeros before constructing BigInts, and reject values over 100.
  const normalized = whole.replace(/^0+/, '') || '0';
  if (normalized.length > 3 || Number(normalized) > 100 ||
      (normalized === '100' && /[1-9]/.test(fraction))) {
    throw new Error('손실 허용률은 0보다 크고 100 이하여야 합니다.');
  }
  const numerator = BigInt(normalized + fraction);
  if (numerator === 0n) {
    throw new Error('손실 허용률은 0보다 크고 100 이하여야 합니다.');
  }
  return { numerator, denominator: 100n * 10n ** BigInt(fraction.length) };
}

function toSafeNumber(value) {
  if (value < -MAX_SAFE_CENTS || value > MAX_SAFE_CENTS) {
    throw new Error('계산 결과가 허용 범위를 초과했습니다. 입력 금액을 줄여 주세요.');
  }
  return Number(value);
}

/** Replay closed trades against a fixed hypothetical loss boundary. */
export function evaluateSession(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.trades)) {
    throw new Error('세션 정보와 거래 목록을 입력해 주세요.');
  }
  const initial = parseMoney(input.initialBalance, '초기 잔액');
  if (initial === 0n) {
    throw new Error('초기 잔액은 0보다 커야 합니다.');
  }
  const { numerator, denominator } = parsePercent(input.lossPercent);
  // ceil(initial - allowance) = initial - floor(allowance).
  const floor = initial - initial * numerator / denominator;
  let balance = initial;
  let firstBreachIndex = null;
  const events = Array.from(input.trades, (trade, index) => {
    if (!trade || typeof trade !== 'object' || typeof trade.label !== 'string' ||
        !trade.label.trim() || Array.from(trade.label).length > 80) {
      throw new Error('거래 이름은 공백이 아닌 1~80자로 입력해 주세요.');
    }
    const pnl = parseMoney(trade.pnl, '거래 손익', true);
    balance += pnl;
    const remaining = balance - floor;
    const atOrBelow = balance <= floor;
    if (atOrBelow && firstBreachIndex === null) firstBreachIndex = index;
    return {
      label: trade.label,
      pnl: toSafeNumber(pnl),
      balance: toSafeNumber(balance),
      remaining: toSafeNumber(remaining),
      atOrBelow,
    };
  });
  return {
    initialBalance: toSafeNumber(initial),
    floor: toSafeNumber(floor),
    balance: toSafeNumber(balance),
    remaining: toSafeNumber(balance - floor),
    firstBreachIndex,
    events,
  };
}
