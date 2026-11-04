import { evaluateSession } from './practice.js';

const KIND = 'oh-my-prop-practice';
const VERSION = 1;
const MAX_BYTES = 1048576;

function checkSize(text) {
  // UTF-8 never uses fewer bytes than the number of UTF-16 code units.
  if (text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    throw new Error('백업 파일은 1 MiB 이하여야 합니다.');
  }
}

function cleanSession(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session) ||
      typeof session.initialBalance !== 'string' || typeof session.lossPercent !== 'string' ||
      !Array.isArray(session.trades)) {
    throw new Error('올바르지 않은 백업 세션입니다.');
  }
  const trades = Array.from(session.trades, (trade) => {
    if (!trade || typeof trade !== 'object' || Array.isArray(trade) ||
        typeof trade.label !== 'string' || typeof trade.pnl !== 'string') {
      throw new Error('올바르지 않은 백업 거래입니다.');
    }
    return { label: trade.label, pnl: trade.pnl };
  });
  const clean = { initialBalance: session.initialBalance, lossPercent: session.lossPercent, trades };
  evaluateSession(clean);
  return clean;
}

export function serializeBackup(session) {
  const text = JSON.stringify({ kind: KIND, version: VERSION, session: cleanSession(session) });
  checkSize(text);
  return text;
}

export function parseBackup(text) {
  if (typeof text !== 'string') throw new Error('백업은 JSON 텍스트여야 합니다.');
  checkSize(text);
  const backup = JSON.parse(text);
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) ||
      backup.kind !== KIND || backup.version !== VERSION) {
    throw new Error('지원하지 않는 백업 형식입니다.');
  }
  return cleanSession(backup.session);
}
