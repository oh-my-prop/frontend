// Pure state rules for the practice journal screen. No DOM access so the
// blocking, storage and sync decisions stay testable with node --test.

export const PENDING_SETTINGS_MESSAGE =
  '적용하지 않은 세션 설정이 있습니다. 설정을 적용하거나 취소한 뒤 다시 시도해 주세요.';
const UNREADABLE_MESSAGE =
  '기존 저장 데이터를 읽을 수 없어 원본을 보존하는 중입니다. 이 작업은 사용할 수 없습니다. 브라우저 데이터를 삭제하지 마세요.';
const OFFLINE_MESSAGE =
  '서버 동기화를 사용할 수 없습니다. 이 페이지의 다른 기능은 그대로 사용할 수 있습니다.';
const SIGNED_OUT_MESSAGE = '서버 동기화를 사용하려면 먼저 로그인해 주세요.';

/** True when the settings inputs differ from the last applied session. */
export function hasPendingSettings(draft, applied) {
  return draft.initialBalance.trim() !== applied.initialBalance.trim() ||
    draft.lossPercent.trim() !== applied.lossPercent.trim();
}

/**
 * Storage condition of the local copy.
 * source: 'ok' | 'blocked'(저장소 접근 불가) | 'unreadable'(기존 원본 해독 불가)
 * lastWrite: 'none' | 'ok' | 'failed'
 */
export function classifyStorage({ source = 'ok', lastWrite = 'none' } = {}) {
  if (source === 'unreadable') return 'unreadable';
  if (source === 'blocked' || lastWrite === 'failed') return 'unsaved';
  return 'saved';
}

/** Never overwrite an existing record we could not read. */
export function canPersist(storage) {
  return classifyStorage(storage) !== 'unreadable';
}

export function canRetrySave(storage) {
  return classifyStorage(storage) === 'unsaved' && canPersist(storage);
}

export function storageMessage(storage) {
  const state = classifyStorage(storage);
  if (state === 'unreadable') {
    return {
      state,
      warning: true,
      text: '저장 상태: 기존 데이터 읽기 불가 — 원본을 보존하기 위해 저장을 중단했습니다. 이 화면의 내용은 새로고침하면 사라집니다. 브라우저 데이터를 삭제하지 말고 JSON 백업으로 내보내세요.',
    };
  }
  if (state === 'unsaved') {
    return {
      state,
      warning: true,
      text: '저장 상태: 이 화면에만 있음 — 로컬 저장에 실패했습니다. 새로고침하면 사라집니다. 저장을 다시 시도하거나 JSON 백업으로 내보내세요.',
    };
  }
  if (storage.lastWrite === 'none') {
    return {
      state,
      warning: false,
      text: '저장 상태: 저장됨 — 아직 저장할 변경이 없습니다. 변경하면 이 브라우저에 저장합니다. 로컬 저장소는 백업이 아닙니다.',
    };
  }
  return {
    state,
    warning: false,
    text: '저장 상태: 저장됨 — 이 브라우저의 로컬 저장소에 보관했습니다. 로컬 저장소는 백업이 아닙니다.',
  };
}

/** Trade add/delete/clear are blocked while settings are unapplied. */
export function guardTradeChange({ pendingSettings = false } = {}) {
  return pendingSettings ? PENDING_SETTINGS_MESSAGE : null;
}

export function guardImport({ pendingSettings = false, storage } = {}) {
  if (pendingSettings) return PENDING_SETTINGS_MESSAGE;
  if (!canPersist(storage)) return UNREADABLE_MESSAGE;
  return null;
}

/** Confirmation copy; null means the action needs no confirmation. */
export function applyConfirmMessage(tradeCount) {
  if (tradeCount <= 0) return null;
  return `거래 ${tradeCount}개의 모든 과거 잔고와 경계 도달 이력을 처음부터 다시 계산합니다. 계속하시겠습니까?`;
}

export function clearConfirmMessage(tradeCount) {
  if (tradeCount <= 0) return null;
  return `거래 ${tradeCount}개를 모두 삭제합니다. 되돌릴 수 없으며 세션 설정은 그대로 유지됩니다. 계속하시겠습니까?`;
}

function syncGuard({ available = false, user = null, pendingSettings = false } = {}) {
  if (!available) return { ok: false, message: OFFLINE_MESSAGE };
  if (!user) return { ok: false, message: SIGNED_OUT_MESSAGE };
  if (pendingSettings) return { ok: false, message: PENDING_SETTINGS_MESSAGE };
  return { ok: true, message: '' };
}

export function canPush(state) {
  return syncGuard(state);
}

export function canPull(state) {
  const guard = syncGuard(state);
  if (!guard.ok) return guard;
  if (!canPersist(state.storage)) return { ok: false, message: UNREADABLE_MESSAGE };
  return guard;
}

export function syncStatusLabel({ available = false, user = null, revision = null, syncedAtLabel = null } = {}) {
  if (!available) return OFFLINE_MESSAGE;
  if (!user) return '로그인하지 않았습니다. 기록은 이 브라우저에만 저장됩니다.';
  const server = revision === null
    ? '서버에 저장된 기록이 없습니다.'
    : `서버 기록 리비전 ${revision}.`;
  const synced = syncedAtLabel ? ` 마지막 동기화 ${syncedAtLabel}.` : ' 이 화면에서 아직 동기화하지 않았습니다.';
  return `${user.email} 님으로 로그인했습니다. ${server}${synced}`;
}

/**
 * Conflict resolution. `current` is the server copy from a 409 body, or null
 * when the server no longer has a record.
 */
export function resolveConflictChoice(choice, current) {
  if (choice === 'overwrite') {
    return { action: 'push', expectedRevision: current ? current.revision : null };
  }
  if (choice === 'server') {
    if (!current) {
      return { action: 'none', message: '서버에 사용할 기록이 없습니다. 내 기록으로 덮어쓰거나 취소해 주세요.' };
    }
    return { action: 'adopt', revision: current.revision, session: current.session };
  }
  return { action: 'none', message: '충돌 해결을 취소했습니다. 서버와 이 화면의 기록은 모두 그대로입니다.' };
}
