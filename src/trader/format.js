// Display formatting for integer cents and basis points. No floating point is
// used for money: amounts are split into dollars and cents with integer math.

const MINUS = '−';

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCents(cents) {
  const value = BigInt(cents);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const dollars = groupThousands((abs / 100n).toString());
  const rest = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? MINUS : ''}$${dollars}.${rest}`;
}

// 원화는 소수점이 없다. 정수 그룹만 찍는다(가상 USD 표기와 섞이지 않게 '원'을 붙인다).
export function formatKrw(amountKrw) {
  const value = BigInt(amountKrw ?? 0);
  const negative = value < 0n;
  return `${negative ? MINUS : ''}${groupThousands((negative ? -value : value).toString())}원`;
}

export function formatSignedCents(cents) {
  const value = BigInt(cents);
  if (value > 0n) return `+${formatCents(value)}`;
  return formatCents(value);
}

// 1234 bps → "12.34%"; rounds toward zero at two decimals, which is already exact for bps.
export function formatBps(bps) {
  const value = BigInt(bps);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${negative ? MINUS : ''}${whole}${fraction ? `.${fraction}` : ''}%`;
}

export function formatTimestamp(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
