const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const PERCENT_LIMIT = 10000n;

// Parse decimal text directly into hundredths; floating-point arithmetic must not
// decide whether an account is on a loss boundary.
function parseHundredths(value, label, limit, positive = false) {
  if (typeof value !== 'string') {
    throw new Error(`${label}을(를) 숫자로 입력해 주세요.`);
  }

  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label}은(는) 소수점 둘째 자리까지의 숫자로 입력해 주세요.`);
  }

  const [whole, fraction = ''] = text.split('.');
  const digits = (whole + fraction.padEnd(2, '0')).replace(/^0+/, '') || '0';
  const maximum = limit.toString();
  if (digits.length > maximum.length || (digits.length === maximum.length && digits > maximum)) {
    throw new Error(`${label}이(가) 허용 범위를 초과했습니다.`);
  }

  const amount = BigInt(digits);
  if (positive && amount === 0n) {
    throw new Error(`${label}은(는) 0보다 커야 합니다.`);
  }
  return amount;
}

function toSafeNumber(value) {
  if (value < -MAX_SAFE_CENTS || value > MAX_SAFE_CENTS) {
    throw new Error('계산 결과가 허용 범위를 초과했습니다. 입력 금액을 줄여 주세요.');
  }
  return Number(value);
}

/** Calculate hypothetical fixed-rule floors and remaining amounts in cents. */
export function calculateRisk(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('계산에 필요한 값을 입력해 주세요.');
  }

  const initial = parseHundredths(input.initialBalance, '초기 잔액', MAX_SAFE_CENTS);
  const dailyStart = parseHundredths(input.dailyStartEquity, '일일 시작 자산', MAX_SAFE_CENTS);
  const current = parseHundredths(input.currentEquity, '현재 자산', MAX_SAFE_CENTS);
  const dailyPercent = parseHundredths(input.dailyLossPercent, '일일 손실률', PERCENT_LIMIT, true);
  const maxPercent = parseHundredths(input.maxLossPercent, '최대 손실률', PERCENT_LIMIT, true);

  // ceil(base - loss) = base - floor(loss), including for negative floors.
  const dailyFloor = dailyStart - initial * dailyPercent / PERCENT_LIMIT;
  const maxFloor = initial - initial * maxPercent / PERCENT_LIMIT;
  const dailyRemaining = current - dailyFloor;
  const maxRemaining = current - maxFloor;
  const limitingRemaining = dailyRemaining < maxRemaining ? dailyRemaining : maxRemaining;
  const limitingRule = dailyRemaining === maxRemaining
    ? 'both'
    : dailyRemaining < maxRemaining ? 'daily' : 'maximum';

  return {
    dailyFloor: toSafeNumber(dailyFloor),
    maxFloor: toSafeNumber(maxFloor),
    dailyRemaining: toSafeNumber(dailyRemaining),
    maxRemaining: toSafeNumber(maxRemaining),
    limitingRemaining: toSafeNumber(limitingRemaining),
    limitingRule,
  };
}
