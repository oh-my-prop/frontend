// Phrases that must never appear in marketing, screen or notification copy
// (product spec §5, compliance strategy 03 §4.5). They suggest a guaranteed
// outcome, investment advice or a licensed brokerage, none of which this
// simulation service offers. test/banned-phrases.test.mjs scans every *.html
// file and every src/**/*.js file (except this one) for them.

export const BANNED_PHRASES = [
  // From the compliance list
  '보장',
  '확정 수익',
  '원금',
  '무위험',
  '투자 자문',
  '증권사',
  // Sensible additions: the same promises in other words
  '수익 보장',
  '원금 보장',
  '100%',
  '무조건',
  '고수익',
  '확실한 수익',
  '투자 권유',
  '손실 없',
  '위험 없',
  '리스크 없',
  '대박',
];

// Legitimate negated legal sentences. Each entry allows exactly this sentence in
// exactly this file; the same phrase anywhere else still fails. Only pages under
// legal/ may be listed (the test enforces it), and an entry whose sentence no
// longer appears in its file fails the test, so the list cannot go stale.
export const ALLOWLIST = [
  {
    file: 'legal/terms.html',
    text: '서비스는 투자 자문이나 투자 권유를 제공하지 않습니다',
    reason: '이용약관 제2조: 서비스가 투자 자문·권유가 아님을 밝히는 부정문',
  },
  {
    file: 'legal/terms.html',
    text: '서비스는 어떠한 원금이나 수익도 보장하지 않습니다',
    reason: '이용약관 제2조: 원금·수익 보장이 없음을 밝히는 부정문(전략 03 §2 유사수신 완화 조치)',
  },
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Spaces in a phrase match any (or no) whitespace, so "투자자문" is caught too.
const PATTERNS = BANNED_PHRASES.map((phrase) => ({
  phrase,
  pattern: new RegExp(phrase.split(/\s+/).map(escape).join('\\s*'), 'g'),
}));

// Occurrences of banned phrases in `text`, after blanking out the allowed
// sentences. Returns [{ phrase, line, excerpt }].
export function findBannedPhrases(text, allowedSentences = []) {
  let masked = text;
  for (const sentence of allowedSentences) masked = masked.split(sentence).join(' '.repeat(sentence.length));
  const hits = [];
  for (const { phrase, pattern } of PATTERNS) {
    for (const match of masked.matchAll(pattern)) {
      const line = masked.slice(0, match.index).split('\n').length;
      const excerpt = text.split('\n')[line - 1].trim().slice(0, 120);
      hits.push({ phrase, line, excerpt });
    }
  }
  return hits;
}
