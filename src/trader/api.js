// Same-origin client for API v2 (and the v1 auth endpoints it shares).
// Every call resolves to { ok: true, ...body } or { ok: false, code, message, status }.

const TIMEOUT_MS = 10000;
const OFFLINE = { ok: false, code: 'offline', status: 0, message: '서버에 연결할 수 없습니다.' };

export function newKey() {
  if (globalThis.crypto?.randomUUID) return `ord-${globalThis.crypto.randomUUID()}`;
  return `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function request(method, path, { body, headers = {} } = {}) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  if (typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(TIMEOUT_MS);
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ...OFFLINE };
  }
  if (response.status === 204) return { ok: true };
  if (!(response.headers.get('content-type') || '').includes('application/json')) return { ...OFFLINE };
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ...OFFLINE };
  }
  if (response.ok) return { ok: true, status: response.status, ...payload };
  const error = payload?.error ?? {};
  return { ok: false, status: response.status, code: error.code ?? 'internal', message: error.message ?? '서버 오류가 발생했습니다.', ...payload };
}

export const getMe = () => request('GET', '/api/v1/auth/me');
export const login = (email, password) => request('POST', '/api/v1/auth/login', { body: { email, password } });
export const register = (email, password) => request('POST', '/api/v1/auth/register', { body: { email, password } });
export const logout = () => request('POST', '/api/v1/auth/logout');
export const loginTotp = (challenge, code) => request('POST', '/api/v1/auth/login/totp', { body: { challenge, code } });
export const totpSetup = () => request('POST', '/api/v1/auth/totp/setup');
export const totpEnable = (code) => request('POST', '/api/v1/auth/totp/enable', { body: { code } });
export const totpDisable = (code) => request('POST', '/api/v1/auth/totp/disable', { body: { code } });
export const getAppeals = (id) => request('GET', `/api/v2/accounts/${id}/appeals`);
export const createAppeal = (id, eventSeq, reason) => request('POST', `/api/v2/accounts/${id}/appeals`, { body: { eventSeq, reason } });

export const listPrograms = () => request('GET', '/api/v2/programs');
export const getProgram = (code, version) => request('GET', `/api/v2/programs/${encodeURIComponent(code)}/versions/${version}`);
export const getLeaderboard = (code, version) => request('GET', `/api/v2/programs/${encodeURIComponent(code)}/versions/${version}/leaderboard`);
export const listAccounts = () => request('GET', '/api/v2/accounts');
export const getAccount = (id) => request('GET', `/api/v2/accounts/${id}`);
export const getEvents = (id, after = 0) => request('GET', `/api/v2/accounts/${id}/events?after=${after}&limit=1000`);
export const getQuotes = () => request('GET', '/api/v2/market/quotes');
export function getCandles(symbol, { since, limit = 240 } = {}) {
  const query = new URLSearchParams({ symbol, limit: String(limit) });
  if (since) query.set('since', since);
  return request('GET', `/api/v2/market/candles?${query}`);
}

export const openAccount = (program, version, acceptedRulesSha256) =>
  request('POST', '/api/v2/accounts', { body: { program, version, acceptedRulesSha256 } });

// Checkout (paid evaluations). The order is created with a client-made
// Idempotency-Key that is reused on every retry, so a resend cannot charge twice.
export const createOrder = (program, version, acceptedRulesSha256, key) =>
  request('POST', '/api/v2/checkout', { body: { program, version, acceptedRulesSha256 }, headers: { 'Idempotency-Key': key } });
export const listOrders = () => request('GET', '/api/v2/checkout');
export const getOrder = (orderId) => request('GET', `/api/v2/checkout/${encodeURIComponent(orderId)}`);
export const confirmOrder = (orderId, paymentKey, amountKrw) =>
  request('POST', `/api/v2/checkout/${encodeURIComponent(orderId)}/confirm`, { body: { paymentKey, amountKrw } });
export const refundOrder = (orderId) => request('POST', `/api/v2/checkout/${encodeURIComponent(orderId)}/refund`);

// There is no real payment widget yet. These two exist only when the server runs with
// MONEY_DEV_TOOLS (never in production); the probe is how the screen finds that out,
// because no production endpoint reports it (backend/src/api-money.js:84).
export const devToolsAvailable = () => request('GET', '/api/v2/dev/money/state').then((result) => result.ok === true);
export const devMockPay = (orderId) => request('POST', '/api/v2/dev/mock/pay', { body: { orderId } });

// The idempotency key is created once per user action and reused on retry, so a
// timed-out request can be sent again without trading twice.
export function placeOrder(id, order, key = newKey()) {
  return request('POST', `/api/v2/accounts/${id}/orders`, { body: order, headers: { 'Idempotency-Key': key } }).then((result) => ({ ...result, key }));
}
export const cancelOrder = (id, orderId) => request('DELETE', `/api/v2/accounts/${id}/orders/${encodeURIComponent(orderId)}`);
export const closePosition = (id, symbol, key = newKey()) =>
  request('POST', `/api/v2/accounts/${id}/positions/${encodeURIComponent(symbol)}/close`, { headers: { 'Idempotency-Key': key } });

// Live updates. EventSource reconnects by itself and resends Last-Event-ID, so
// the server replays anything missed; `onStatus` reports connected/reconnecting.
export function openStream(id, { onSnapshot, onEvent, onStatus }) {
  if (typeof EventSource !== 'function') {
    onStatus?.('unsupported');
    return () => {};
  }
  const source = new EventSource(`/api/v2/accounts/${id}/stream`);
  source.addEventListener('open', () => onStatus?.('live'));
  source.addEventListener('error', () => onStatus?.(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting'));
  source.addEventListener('snapshot', (message) => onSnapshot?.(JSON.parse(message.data)));
  source.addEventListener('event', (message) => onEvent?.(JSON.parse(message.data)));
  return () => source.close();
}
