// Same-origin client for the optional sync backend. Every function resolves to
// a result object; a missing backend (static hosting) normalizes to 'offline'.

const BASE = '/api/v1';
const TIMEOUT_MS = 10000;
const OFFLINE = { ok: false, code: 'offline', message: '서버에 연결할 수 없습니다. 기록은 이 브라우저에만 저장됩니다.' };
const MESSAGES = {
  unauthorized: '로그인이 필요합니다.',
  invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
  email_taken: '이미 가입된 이메일입니다.',
  validation_failed: '입력값을 확인해 주세요.',
  rate_limited: '시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
  payload_too_large: '기록이 너무 커서 서버에 저장할 수 없습니다.',
  revision_conflict: '서버 기록이 이미 변경되었습니다.',
  not_found: '서버에 저장된 기록이 없습니다.',
  forbidden_origin: '허용되지 않은 출처에서의 요청입니다.',
  internal: '서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};

function timeoutSignal() {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined;
  return AbortSignal.timeout(TIMEOUT_MS);
}

async function request(method, path, body) {
  if (typeof fetch !== 'function') return { ...OFFLINE };
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutSignal(),
    });
  } catch {
    return { ...OFFLINE };
  }
  if (response.status === 204) return { ok: true };
  // A static file server answers with HTML (or nothing); treat that as offline.
  if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return { ...OFFLINE };
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ...OFFLINE };
  }
  if (!payload || typeof payload !== 'object') return { ...OFFLINE };
  if (response.ok) return { ok: true, ...payload };
  const error = payload.error && typeof payload.error === 'object' ? payload.error : {};
  const code = typeof error.code === 'string' ? error.code : 'internal';
  const message = typeof error.message === 'string' && error.message ? error.message : (MESSAGES[code] || MESSAGES.internal);
  if (response.status === 409) {
    return { ok: false, code: 'revision_conflict', message, current: payload.current ?? null };
  }
  return { ok: false, code, message };
}

export async function getMe() {
  return request('GET', '/auth/me');
}

export async function register(email, password) {
  return request('POST', '/auth/register', { email, password });
}

export async function login(email, password) {
  return request('POST', '/auth/login', { email, password });
}

export async function logout() {
  return request('POST', '/auth/logout');
}

export async function fetchJournal() {
  return request('GET', '/journal');
}

export async function pushJournal(session, expectedRevision) {
  return request('PUT', '/journal', { expectedRevision: expectedRevision ?? null, session });
}

export async function deleteJournal(expectedRevision) {
  const query = expectedRevision === null || expectedRevision === undefined
    ? ''
    : `?expectedRevision=${encodeURIComponent(expectedRevision)}`;
  return request('DELETE', `/journal${query}`);
}
