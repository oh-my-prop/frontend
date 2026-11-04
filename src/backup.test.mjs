import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup, serializeBackup } from './backup.js';

const session = {
  initialBalance: '100000.00',
  lossPercent: '2.5',
  trades: [{ label: '첫 거래 📈', pnl: '-12.34' }, { label: 'Recovery', pnl: '+50' }],
};
const envelope = (value = session) => ({ kind: 'oh-my-prop-practice', version: 1, session: value });
const encode = (value) => JSON.stringify(value);

test('round-trips string inputs, Unicode, and empty trade lists', () => {
  const text = serializeBackup(session);
  assert.deepEqual(JSON.parse(text), envelope());
  const restored = parseBackup(text);
  assert.deepEqual(restored, session);
  assert.notStrictEqual(restored, session);
  assert.notStrictEqual(restored.trades[0], session.trades[0]);
  const empty = { initialBalance: '1', lossPercent: '100', trades: [] };
  assert.deepEqual(parseBackup(serializeBackup(empty)), empty);
});

test('copies only supported session and trade fields', () => {
  const source = { ...session, extra: 'private', trades: [{ ...session.trades[0], extra: 'private' }] };
  const clean = { initialBalance: session.initialBalance, lossPercent: session.lossPercent,
    trades: [{ label: session.trades[0].label, pnl: session.trades[0].pnl }] };
  assert.deepEqual(JSON.parse(serializeBackup(source)), envelope(clean));
  assert.deepEqual(parseBackup(encode({ ...envelope(source), extra: 'private' })), clean);
});

test('rejects unsupported envelopes and malformed session schemas', () => {
  for (const value of [null, [], {}, { ...envelope(), kind: 'other' },
    { ...envelope(), version: 2 }, { ...envelope(), version: '1' },
    { ...envelope(), session: null }, { ...envelope(), session: [] },
    envelope({ ...session, initialBalance: 100 }), envelope({ ...session, lossPercent: 5 }),
    envelope({ ...session, trades: {} }), envelope({ ...session, trades: [null] }),
    envelope({ ...session, trades: [['label', '1']] }),
    envelope({ ...session, trades: [{ label: 'trade', pnl: 1 }] }),
    envelope({ ...session, trades: [{ pnl: '1' }] })]) {
    assert.throws(() => parseBackup(encode(value)));
  }
  assert.throws(() => serializeBackup(null));
  assert.throws(() => serializeBackup({ ...session, trades: [{ label: 'trade', pnl: 1 }] }));
});

test('rejects invalid domain values and arithmetic overflow', () => {
  for (const value of [
    { ...session, initialBalance: '0' },
    { ...session, initialBalance: 'not a number' },
    { ...session, lossPercent: '0' },
    { ...session, lossPercent: '100.01' },
    { ...session, trades: [{ label: ' ', pnl: '1' }] },
    { ...session, trades: [{ label: 'a'.repeat(81), pnl: '1' }] },
    { ...session, trades: [{ label: 'trade', pnl: '0.001' }] },
    { ...session, initialBalance: '90071992547409.92', trades: [] },
    { initialBalance: '90071992547409.91', lossPercent: '100', trades: [{ label: 'trade', pnl: '0.01' }] },
  ]) {
    assert.throws(() => parseBackup(encode(envelope(value))));
    assert.throws(() => serializeBackup(value));
  }
});

test('enforces the 1 MiB UTF-8 limit including multibyte characters', () => {
  const base = encode(envelope({ initialBalance: '1', lossPercent: '1', trades: [] }));
  const limit = 1048576;
  assert.deepEqual(parseBackup(base + ' '.repeat(limit - base.length)),
    { initialBalance: '1', lossPercent: '1', trades: [] });
  assert.throws(() => parseBackup(base + ' '.repeat(limit - base.length + 1)));
  const unicode = encode({ ...envelope(), extra: '한'.repeat(350000) });
  assert.ok(unicode.length < limit);
  assert.throws(() => parseBackup(unicode));
  const large = { initialBalance: '1', lossPercent: '1',
    trades: Array.from({ length: 50000 }, () => ({ label: 'x', pnl: '0' })) };
  assert.throws(() => serializeBackup(large));
});

test('rejects corrupt JSON and non-string input', () => {
  for (const text of ['', '{', '{"kind":', 'null trailing', null, {}, 123]) {
    assert.throws(() => parseBackup(text));
  }
});
