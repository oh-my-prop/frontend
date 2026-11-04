import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PENDING_SETTINGS_MESSAGE,
  applyConfirmMessage,
  canPersist,
  canPull,
  canPush,
  canRetrySave,
  classifyStorage,
  clearConfirmMessage,
  guardImport,
  guardTradeChange,
  hasPendingSettings,
  resolveConflictChoice,
  storageMessage,
  syncStatusLabel,
} from './journal-state.js';

const applied = { initialBalance: '100000', lossPercent: '5' };
const user = { id: 'u1', email: 'trader@example.com' };

test('settings stay pending until the draft matches the applied values again', () => {
  assert.equal(hasPendingSettings({ ...applied }, applied), false);
  assert.equal(hasPendingSettings({ initialBalance: ' 100000 ', lossPercent: '5\n' }, applied), false);
  assert.equal(hasPendingSettings({ initialBalance: '100000.00', lossPercent: '5' }, applied), true);
  assert.equal(hasPendingSettings({ initialBalance: '100000', lossPercent: '5.0' }, applied), true);
  assert.equal(hasPendingSettings({ initialBalance: '', lossPercent: '5' }, applied), true);
});

test('unreadable storage blocks every write while failed writes stay retryable', () => {
  const unreadable = { source: 'unreadable', lastWrite: 'none' };
  assert.equal(classifyStorage(unreadable), 'unreadable');
  assert.equal(canPersist(unreadable), false);
  assert.equal(canRetrySave(unreadable), false);
  // A later successful write must not clear the unreadable original.
  assert.equal(classifyStorage({ source: 'unreadable', lastWrite: 'ok' }), 'unreadable');

  const failed = { source: 'ok', lastWrite: 'failed' };
  assert.equal(classifyStorage(failed), 'unsaved');
  assert.equal(canPersist(failed), true);
  assert.equal(canRetrySave(failed), true);

  const blocked = { source: 'blocked', lastWrite: 'none' };
  assert.equal(classifyStorage(blocked), 'unsaved');
  assert.equal(canRetrySave(blocked), true);

  assert.equal(classifyStorage({ source: 'ok', lastWrite: 'ok' }), 'saved');
  assert.equal(canRetrySave({ source: 'ok', lastWrite: 'ok' }), false);
});

test('storage messages separate the three states and mark the risky ones', () => {
  const saved = storageMessage({ source: 'ok', lastWrite: 'ok' });
  const fresh = storageMessage({ source: 'ok', lastWrite: 'none' });
  const unsaved = storageMessage({ source: 'ok', lastWrite: 'failed' });
  const unreadable = storageMessage({ source: 'unreadable' });
  assert.deepEqual([saved.state, fresh.state, unsaved.state, unreadable.state],
    ['saved', 'saved', 'unsaved', 'unreadable']);
  assert.deepEqual([saved.warning, fresh.warning, unsaved.warning, unreadable.warning],
    [false, false, true, true]);
  assert.notEqual(saved.text, fresh.text);
  assert.match(unsaved.text, /이 화면에만 있음/);
  assert.match(unreadable.text, /읽기 불가/);
});

test('pending settings block trades and imports, unreadable storage blocks imports alone', () => {
  assert.equal(guardTradeChange({ pendingSettings: false }), null);
  assert.equal(guardTradeChange({ pendingSettings: true }), PENDING_SETTINGS_MESSAGE);
  const storage = { source: 'ok', lastWrite: 'ok' };
  assert.equal(guardImport({ pendingSettings: false, storage }), null);
  assert.equal(guardImport({ pendingSettings: true, storage }), PENDING_SETTINGS_MESSAGE);
  const unreadable = guardImport({ pendingSettings: false, storage: { source: 'unreadable' } });
  assert.match(unreadable, /보존/);
  // Pending settings are reported first so the user clears one blocker at a time.
  assert.equal(guardImport({ pendingSettings: true, storage: { source: 'unreadable' } }), PENDING_SETTINGS_MESSAGE);
});

test('confirmations appear only when trades would be recalculated or lost', () => {
  assert.equal(applyConfirmMessage(0), null);
  assert.equal(clearConfirmMessage(0), null);
  assert.match(applyConfirmMessage(2), /거래 2개/);
  assert.match(applyConfirmMessage(2), /다시 계산/);
  assert.match(clearConfirmMessage(3), /거래 3개/);
  assert.match(clearConfirmMessage(3), /되돌릴 수 없/);
});

test('sync actions require a backend, a session and applied settings', () => {
  const storage = { source: 'ok', lastWrite: 'ok' };
  const base = { available: true, user, pendingSettings: false, storage };
  assert.equal(canPush(base).ok, true);
  assert.equal(canPull(base).ok, true);

  for (const action of [canPush, canPull]) {
    assert.equal(action({ ...base, available: false }).ok, false);
    assert.equal(action({ ...base, user: null }).ok, false);
    assert.equal(action({ ...base, pendingSettings: true }).message, PENDING_SETTINGS_MESSAGE);
  }
  // Pulling overwrites the local copy, so it needs a writable store; pushing does not.
  const unreadable = { ...base, storage: { source: 'unreadable' } };
  assert.equal(canPull(unreadable).ok, false);
  assert.equal(canPush(unreadable).ok, true);
  assert.match(canPush({ ...base, available: false }).message, /사용할 수 없습니다/);
});

test('sync label reports the account, the server revision and the last sync', () => {
  assert.match(syncStatusLabel({ available: false, user }), /사용할 수 없습니다/);
  assert.match(syncStatusLabel({ available: true, user: null }), /로그인하지 않았습니다/);
  const fresh = syncStatusLabel({ available: true, user, revision: null, syncedAtLabel: null });
  assert.match(fresh, /trader@example\.com/);
  assert.match(fresh, /저장된 기록이 없습니다/);
  const synced = syncStatusLabel({ available: true, user, revision: 7, syncedAtLabel: '2026-11-04 10:00' });
  assert.match(synced, /리비전 7/);
  assert.match(synced, /2026-11-04 10:00/);
});

test('conflict choices pick the retry revision or adopt the server copy', () => {
  const session = { initialBalance: '1000', lossPercent: '2', trades: [] };
  const current = { revision: 4, updatedAt: '2026-11-04T01:00:00.000Z', session };

  assert.deepEqual(resolveConflictChoice('overwrite', current), { action: 'push', expectedRevision: 4 });
  assert.deepEqual(resolveConflictChoice('overwrite', null), { action: 'push', expectedRevision: null });
  assert.deepEqual(resolveConflictChoice('server', current), { action: 'adopt', revision: 4, session });

  const missing = resolveConflictChoice('server', null);
  assert.equal(missing.action, 'none');
  assert.match(missing.message, /사용할 기록이 없습니다/);

  const cancelled = resolveConflictChoice('cancel', current);
  assert.equal(cancelled.action, 'none');
  assert.match(cancelled.message, /그대로/);
});
