import { evaluateSession } from './practice.js';
import { serializeBackup, parseBackup } from './backup.js';
import {
  applyConfirmMessage,
  canPersist,
  canPull,
  canPush,
  canRetrySave,
  clearConfirmMessage,
  guardImport,
  guardTradeChange,
  hasPendingSettings,
  resolveConflictChoice,
  storageMessage,
  syncStatusLabel,
} from './journal-state.js';
import { fetchJournal, getMe, login, logout, pushJournal, register } from './sync.js';

const STORAGE_KEY = 'oh-my-prop.practice-journal.v1';
const MAX_BACKUP_BYTES = 1024 * 1024;
const defaults = { initialBalance: '100000', lossPercent: '5', trades: [] };
const initialInput = document.querySelector('#initial-balance');
const percentInput = document.querySelector('#loss-percent');
const labelInput = document.querySelector('#trade-label');
const pnlInput = document.querySelector('#trade-pnl');
const error = document.querySelector('#error');
const pendingNotice = document.querySelector('#settings-pending');
const applyButton = document.querySelector('#apply-settings');
const cancelButton = document.querySelector('#cancel-settings');
const storageStatus = document.querySelector('#storage-status');
const retryButton = document.querySelector('#retry-save');
const summary = document.querySelector('#summary');
const list = document.querySelector('#trade-list');
const emptyList = document.querySelector('#empty-list');
const clearButton = document.querySelector('#clear-trades');
const exportButton = document.querySelector('#export-backup');
const importInput = document.querySelector('#import-backup');
const backupStatus = document.querySelector('#backup-status');
const syncAccount = document.querySelector('#sync-account');
const authForm = document.querySelector('#auth-form');
const emailInput = document.querySelector('#auth-email');
const passwordInput = document.querySelector('#auth-password');
const authSubmit = document.querySelector('#auth-submit');
const authToggle = document.querySelector('#auth-toggle');
const syncActions = document.querySelector('#sync-actions');
const pushButton = document.querySelector('#sync-push');
const pullButton = document.querySelector('#sync-pull');
const logoutButton = document.querySelector('#auth-logout');
const conflictBox = document.querySelector('#conflict');
const conflictDetail = document.querySelector('#conflict-detail');
const conflictPreview = document.querySelector('#conflict-preview');
const conflictView = document.querySelector('#conflict-view');
const conflictAdopt = document.querySelector('#conflict-adopt');
const conflictOverwrite = document.querySelector('#conflict-overwrite');
const conflictCancel = document.querySelector('#conflict-cancel');
const syncStatus = document.querySelector('#sync-status');
const syncError = document.querySelector('#sync-error');

let applied = { ...defaults, trades: [] };
const storage = { source: 'ok', lastWrite: 'none' };
const sync = { available: true, user: null, revision: null, syncedAtLabel: null };
let conflictCurrent = null;
let authMode = 'login';
let importRequest = 0;

function setError(message) {
  error.textContent = message;
  error.hidden = false;
}

function clearError() {
  error.textContent = '';
  error.hidden = true;
}

function draft() {
  return { initialBalance: initialInput.value, lossPercent: percentInput.value };
}

function pending() {
  return hasPendingSettings(draft(), applied);
}

function refreshStorage() {
  const message = storageMessage(storage);
  storageStatus.textContent = message.text;
  storageStatus.classList.toggle('warning', message.warning);
  retryButton.hidden = !canRetrySave(storage);
}

function refreshPending() {
  const blocked = pending();
  pendingNotice.textContent = blocked
    ? '적용하지 않은 설정 변경이 있습니다. 설정 적용을 누르면 모든 거래를 처음부터 다시 계산하고, 변경 취소를 누르면 마지막 적용값으로 되돌립니다. 그 전에는 거래 추가·삭제와 백업 가져오기, 서버 동기화를 사용할 수 없습니다.'
    : '';
  pendingNotice.hidden = !blocked;
  for (const element of [clearButton, pushButton, pullButton]) {
    element.setAttribute('aria-disabled', String(blocked));
  }
  initialInput.classList.toggle('draft', blocked);
  percentInput.classList.toggle('draft', blocked);
}

function persist(session) {
  if (!canPersist(storage)) {
    refreshStorage();
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...session }));
    storage.lastWrite = 'ok';
  } catch {
    storage.lastWrite = 'failed';
  }
  refreshStorage();
  return storage.lastWrite === 'ok';
}

function loadSession() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    storage.source = 'blocked';
    return;
  }
  if (raw === null) return;
  try {
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1 || typeof saved.initialBalance !== 'string' ||
        typeof saved.lossPercent !== 'string' || !Array.isArray(saved.trades) ||
        !saved.trades.every((trade) => trade && typeof trade.label === 'string' &&
          trade.label.trim() !== '' && typeof trade.pnl === 'string')) {
      throw new Error('invalid journal');
    }
    const restored = {
      initialBalance: saved.initialBalance,
      lossPercent: saved.lossPercent,
      trades: saved.trades.map(({ label, pnl }) => ({ label, pnl })),
    };
    evaluateSession(restored);
    applied = restored;
    storage.lastWrite = 'ok';
  } catch {
    // Keep the unreadable original untouched instead of overwriting it.
    storage.source = 'unreadable';
  }
}

// Format integer cents without rounding large safe integers through floating-point dollars.
function money(cents) {
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const dollars = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0n ? '-' : ''}$${dollars}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function text(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = content;
  return element;
}

function render(result) {
  summary.hidden = false;
  list.hidden = false;
  document.querySelector('#floor').textContent = money(result.floor);
  document.querySelector('#balance').textContent = money(result.balance);
  document.querySelector('#remaining').textContent = money(result.remaining);
  const current = document.querySelector('#current-status');
  const breached = result.balance <= result.floor;
  current.textContent = breached ? '현재 상태: 가상 경계에 도달했거나 그 아래입니다.' : '현재 상태: 가상 경계 위입니다.';
  current.classList.toggle('breached', breached);
  document.querySelector('#breach-status').textContent = result.firstBreachIndex === null
    ? '첫 경계 도달: 아직 없음'
    : `첫 경계 도달: ${result.firstBreachIndex + 1}번째 거래 (${result.events[result.firstBreachIndex].label}). 이후 회복해도 이력이 유지됩니다.`;
  list.replaceChildren();
  result.events.forEach((event, index) => {
    const item = document.createElement('li');
    const heading = document.createElement('div');
    heading.className = 'trade-heading';
    heading.append(text('strong', '', `${index + 1}. ${event.label}`));
    const remove = text('button', 'remove-button', '삭제');
    remove.type = 'button';
    remove.setAttribute('aria-label', `${index + 1}번째 거래 ${event.label} 삭제`);
    remove.addEventListener('click', () => removeTrade(index));
    heading.append(remove);
    item.append(heading, text('p', '', `순손익 ${money(event.pnl)} · 잔고 ${money(event.balance)} · 남은 금액 ${money(event.remaining)}`));
    item.append(text('p', event.atOrBelow ? 'event-breach' : 'event-status', event.atOrBelow ? '경계 도달 또는 아래' : '경계 위'));
    list.append(item);
  });
  emptyList.hidden = result.events.length !== 0;
}

/** Replace the whole on-screen session after it is already validated and stored. */
function adopt(session, result) {
  applied = session;
  initialInput.value = session.initialBalance;
  percentInput.value = session.lossPercent;
  labelInput.value = '';
  pnlInput.value = '';
  clearError();
  render(result);
  refreshPending();
}

/** Trades change against the already applied settings, so only trades can fail. */
function commitTrades(trades) {
  const candidate = { initialBalance: applied.initialBalance, lossPercent: applied.lossPercent, trades };
  try {
    const result = evaluateSession(candidate);
    applied = candidate;
    clearError();
    render(result);
    persist(applied);
    return true;
  } catch (problem) {
    setError(`${problem instanceof Error ? problem.message : '입력값을 확인해 주세요.'} 유효하지 않은 변경 내용은 저장되지 않았습니다.`);
    return false;
  }
}

function applySettings() {
  if (!pending()) {
    setError('변경된 설정이 없습니다. 초기 잔고나 손실 허용 비율을 수정한 뒤 적용해 주세요.');
    return false;
  }
  const candidate = { initialBalance: initialInput.value, lossPercent: percentInput.value, trades: applied.trades };
  let result;
  try {
    result = evaluateSession(candidate);
  } catch (problem) {
    setError(`${problem instanceof Error ? problem.message : '입력값을 확인해 주세요.'} 유효하지 않은 변경 내용은 저장되지 않았습니다.`);
    return false;
  }
  const question = applyConfirmMessage(applied.trades.length);
  if (question && !confirm(question)) {
    setError('설정 적용을 취소했습니다. 기록·결과·저장된 내용은 그대로입니다. 입력한 초안은 아직 적용되지 않았습니다.');
    return false;
  }
  applied = candidate;
  clearError();
  render(result);
  persist(applied);
  refreshPending();
  return true;
}

function cancelSettings() {
  initialInput.value = applied.initialBalance;
  percentInput.value = applied.lossPercent;
  clearError();
  refreshPending();
  initialInput.focus();
}

function removeTrade(index) {
  const blocked = guardTradeChange({ pendingSettings: pending() });
  if (blocked) {
    setError(blocked);
    applyButton.focus();
    return;
  }
  if (!commitTrades(applied.trades.filter((_, position) => position !== index))) return;
  const buttons = list.querySelectorAll('.remove-button');
  const next = buttons[Math.min(index, buttons.length - 1)];
  (next || clearButton).focus();
}

loadSession();
initialInput.value = applied.initialBalance;
percentInput.value = applied.lossPercent;
render(evaluateSession(applied));
refreshStorage();
refreshPending();

document.querySelector('#settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  applySettings();
});
cancelButton.addEventListener('click', cancelSettings);
initialInput.addEventListener('input', refreshPending);
percentInput.addEventListener('input', refreshPending);

retryButton.addEventListener('click', () => {
  if (persist(applied)) {
    backupStatus.textContent = '저장을 다시 시도해 성공했습니다.';
    return;
  }
  backupStatus.textContent = '저장을 다시 시도했지만 실패했습니다. JSON 백업으로 내보내 두세요.';
});

document.querySelector('#trade-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const blocked = guardTradeChange({ pendingSettings: pending() });
  if (blocked) {
    setError(blocked);
    applyButton.focus();
    return;
  }
  const label = labelInput.value.trim();
  if (!label) {
    setError('거래 이름을 입력해 주세요. 이 거래는 아직 저장되지 않았습니다.');
    labelInput.focus();
    return;
  }
  if (commitTrades([...applied.trades, { label, pnl: pnlInput.value }])) {
    labelInput.value = '';
    pnlInput.value = '';
    labelInput.focus();
  }
});

clearButton.addEventListener('click', () => {
  const blocked = guardTradeChange({ pendingSettings: pending() });
  if (blocked) {
    setError(blocked);
    applyButton.focus();
    return;
  }
  const question = clearConfirmMessage(applied.trades.length);
  if (!question) {
    setError('삭제할 거래가 없습니다.');
    return;
  }
  if (!confirm(question)) {
    setError('전체 삭제를 취소했습니다. 기록과 저장된 내용은 그대로입니다.');
    return;
  }
  commitTrades([]);
  clearButton.focus();
});

exportButton.addEventListener('click', () => {
  try {
    const json = serializeBackup(applied);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'oh-my-prop-practice.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    backupStatus.textContent = pending()
      ? '마지막으로 적용한 세션만 백업 파일로 내려받습니다. 적용하지 않은 설정은 포함되지 않았습니다.'
      : '백업 파일을 다운로드합니다. 민감한 정보가 포함될 수 있으니 안전하게 보관하세요.';
  } catch {
    backupStatus.textContent = '백업 파일을 만들지 못했습니다.';
  }
});

importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  const request = ++importRequest;
  if (!file) return;
  const blocked = guardImport({ pendingSettings: pending(), storage });
  if (blocked) {
    backupStatus.textContent = blocked;
    return;
  }
  if (file.size > MAX_BACKUP_BYTES) {
    backupStatus.textContent = '백업 파일은 1 MiB 이하여야 합니다.';
    return;
  }

  let candidate;
  let result;
  try {
    const contents = await file.text();
    if (request !== importRequest) return;
    candidate = parseBackup(contents);
    result = evaluateSession(candidate);
  } catch {
    if (request === importRequest) backupStatus.textContent = '백업 파일을 읽거나 확인하지 못했습니다. 올바른 JSON 백업 파일을 선택해 주세요.';
    return;
  }
  if (!confirm('현재 세션의 모든 설정과 거래가 백업 파일의 내용으로 대체됩니다. 아직 저장되지 않은 내용도 함께 사라집니다. 계속하시겠습니까?')) {
    backupStatus.textContent = '가져오기를 취소했습니다. 현재 세션은 변경되지 않았습니다.';
    return;
  }
  if (!persist(candidate)) {
    backupStatus.textContent = '복원 내용을 로컬 저장소에 저장하지 못했습니다. 현재 세션은 변경되지 않았습니다.';
    return;
  }
  adopt(candidate, result);
  backupStatus.textContent = '백업을 가져왔습니다.';
});

function setSyncStatus(message) {
  syncStatus.textContent = message;
}

function setSyncError(message) {
  syncError.textContent = message;
  syncError.hidden = false;
}

function clearSyncError() {
  syncError.textContent = '';
  syncError.hidden = true;
}

function formatTime(value) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '시각 미상' : time.toLocaleString('ko-KR');
}

function refreshSync() {
  syncAccount.textContent = syncStatusLabel(sync);
  authForm.hidden = !sync.available || Boolean(sync.user);
  syncActions.hidden = !sync.available || !sync.user;
  if (!sync.available || !sync.user) hideConflict();
}

function hideConflict() {
  conflictBox.hidden = true;
  conflictPreview.hidden = true;
  conflictPreview.textContent = '';
  conflictCurrent = null;
}

function handleSyncFailure(result) {
  if (result.code === 'offline') {
    sync.available = false;
    refreshSync();
    setSyncError('서버에 연결할 수 없어 동기화를 사용할 수 없습니다. 이 페이지의 다른 기능은 그대로 사용할 수 있습니다.');
    return;
  }
  if (result.code === 'unauthorized') {
    sync.user = null;
    sync.revision = null;
    refreshSync();
    setSyncError('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    return;
  }
  setSyncError(result.message);
}

async function refreshRevision() {
  const result = await fetchJournal();
  if (result.ok) {
    sync.revision = result.revision;
    return;
  }
  if (result.code === 'not_found') {
    sync.revision = null;
    return;
  }
  handleSyncFailure(result);
}

/** Store a server session locally first; only then replace what is on screen. */
function adoptServerSession(session, revision, updatedAt) {
  let clean;
  let result;
  try {
    clean = parseBackup(serializeBackup(session));
    result = evaluateSession(clean);
  } catch {
    setSyncError('서버 기록을 확인하지 못했습니다. 현재 세션은 변경되지 않았습니다.');
    return false;
  }
  if (!persist(clean)) {
    setSyncError('서버 기록을 로컬 저장소에 저장하지 못했습니다. 현재 세션은 변경되지 않았습니다.');
    return false;
  }
  adopt(clean, result);
  sync.revision = revision;
  sync.syncedAtLabel = formatTime(updatedAt);
  hideConflict();
  refreshSync();
  setSyncStatus(`서버 기록(리비전 ${revision})을 불러와 이 브라우저에 저장했습니다.`);
  return true;
}

async function pushSession(expectedRevision) {
  const guard = canPush({ available: sync.available, user: sync.user, pendingSettings: pending() });
  if (!guard.ok) {
    setSyncError(guard.message);
    return;
  }
  clearSyncError();
  setSyncStatus('서버에 저장하는 중입니다.');
  const result = await pushJournal(applied, expectedRevision);
  if (result.ok) {
    sync.revision = result.revision;
    sync.syncedAtLabel = formatTime(result.updatedAt);
    hideConflict();
    refreshSync();
    setSyncStatus(`서버에 저장했습니다. 리비전 ${result.revision}.`);
    pushButton.focus();
    return;
  }
  if (result.code === 'revision_conflict') {
    setSyncStatus('서버 기록이 이미 변경되어 저장하지 못했습니다.');
    showConflict(result.current);
    return;
  }
  setSyncStatus('');
  handleSyncFailure(result);
}

function showConflict(current) {
  conflictCurrent = current;
  conflictDetail.textContent = current
    ? `서버에는 리비전 ${current.revision} 기록이 있습니다(갱신 ${formatTime(current.updatedAt)}). 서버 내용을 사용하거나 내 기록으로 덮어쓸 수 있습니다.`
    : '서버 기록이 방금 삭제되었습니다. 내 기록으로 덮어쓰거나 취소할 수 있습니다.';
  conflictPreview.hidden = true;
  conflictPreview.textContent = '';
  conflictView.hidden = !current;
  conflictAdopt.hidden = !current;
  conflictBox.hidden = false;
  (current ? conflictView : conflictOverwrite).focus();
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearSyncError();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  setSyncStatus(authMode === 'login' ? '로그인하는 중입니다.' : '계정을 만드는 중입니다.');
  const result = authMode === 'login' ? await login(email, password) : await register(email, password);
  if (!result.ok) {
    setSyncStatus('');
    handleSyncFailure(result);
    return;
  }
  sync.user = result.user;
  sync.revision = null;
  sync.syncedAtLabel = null;
  passwordInput.value = '';
  await refreshRevision();
  refreshSync();
  setSyncStatus(authMode === 'login' ? '로그인했습니다.' : '계정을 만들고 로그인했습니다.');
  if (!syncActions.hidden) pushButton.focus();
});

authToggle.addEventListener('click', () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  authSubmit.textContent = authMode === 'login' ? '로그인' : '계정 만들기';
  authToggle.textContent = authMode === 'login' ? '계정 만들기로 전환' : '로그인으로 전환';
  passwordInput.setAttribute('autocomplete', authMode === 'login' ? 'current-password' : 'new-password');
  clearSyncError();
  setSyncStatus(authMode === 'login' ? '로그인 모드입니다.' : '계정 만들기 모드입니다. 비밀번호는 10~200자로 입력하세요.');
  emailInput.focus();
});

logoutButton.addEventListener('click', async () => {
  clearSyncError();
  const result = await logout();
  if (!result.ok) {
    handleSyncFailure(result);
    return;
  }
  sync.user = null;
  sync.revision = null;
  sync.syncedAtLabel = null;
  refreshSync();
  setSyncStatus('로그아웃했습니다. 기록은 이 브라우저에 그대로 남아 있습니다.');
  if (!authForm.hidden) emailInput.focus();
});

pushButton.addEventListener('click', () => pushSession(sync.revision));

pullButton.addEventListener('click', async () => {
  const guard = canPull({ available: sync.available, user: sync.user, pendingSettings: pending(), storage });
  if (!guard.ok) {
    setSyncError(guard.message);
    return;
  }
  clearSyncError();
  if (!confirm('서버 기록을 불러오면 이 화면의 모든 설정과 거래가 대체됩니다. 아직 저장되지 않은 내용도 함께 사라집니다. 계속하시겠습니까?')) {
    setSyncStatus('불러오기를 취소했습니다. 현재 세션은 변경되지 않았습니다.');
    return;
  }
  setSyncStatus('서버에서 불러오는 중입니다.');
  const result = await fetchJournal();
  if (!result.ok) {
    setSyncStatus('');
    if (result.code === 'not_found') {
      sync.revision = null;
      refreshSync();
      setSyncError('서버에 저장된 기록이 없습니다. 먼저 서버에 저장해 주세요.');
      return;
    }
    handleSyncFailure(result);
    return;
  }
  adoptServerSession(result.session, result.revision, result.updatedAt);
  pullButton.focus();
});

conflictView.addEventListener('click', () => {
  if (!conflictCurrent) return;
  const server = conflictCurrent.session;
  const trades = Array.isArray(server?.trades) ? server.trades : [];
  const lines = [
    `초기 잔고 ${server?.initialBalance ?? '?'} · 손실 허용 비율 ${server?.lossPercent ?? '?'}% · 거래 ${trades.length}개`,
    ...trades.map((trade, index) => `${index + 1}. ${trade?.label ?? '?'} — ${trade?.pnl ?? '?'}`),
  ];
  conflictPreview.textContent = lines.join('\n');
  conflictPreview.hidden = false;
  conflictPreview.focus();
});

conflictAdopt.addEventListener('click', () => {
  const choice = resolveConflictChoice('server', conflictCurrent);
  if (choice.action !== 'adopt') {
    setSyncError(choice.message);
    return;
  }
  if (!confirm('서버 내용을 사용하면 이 화면의 모든 설정과 거래가 대체됩니다. 계속하시겠습니까?')) {
    setSyncStatus('충돌 해결을 취소했습니다. 서버와 이 화면의 기록은 모두 그대로입니다.');
    return;
  }
  if (adoptServerSession(choice.session, choice.revision, conflictCurrent?.updatedAt)) pushButton.focus();
});

conflictOverwrite.addEventListener('click', () =>
  pushSession(resolveConflictChoice('overwrite', conflictCurrent).expectedRevision));

conflictCancel.addEventListener('click', () => {
  const choice = resolveConflictChoice('cancel', conflictCurrent);
  hideConflict();
  setSyncStatus(choice.message);
  pushButton.focus();
});

(async function initSync() {
  const me = await getMe();
  if (me.ok) {
    sync.user = me.user;
    await refreshRevision();
  } else if (me.code === 'offline') {
    sync.available = false;
  }
  refreshSync();
})();
