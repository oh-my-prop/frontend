// 본인확인 화면의 판단 규칙 (backend/docs/prop/04-money.md §6).
// DOM이 없어 node에서 그대로 테스트할 수 있다.
//
// 이 파일이 지키는 것 세 가지:
//  1. 서버가 본인확인 경로를 열지 않은 환경(404)에서는 화면에서 본인확인을 아예
//     없앤다. 구매 흐름은 그대로 돌아가야 한다.
//  2. 실패 사유마다 다음에 할 일이 다르다. 미성년·중복 확인은 다시 시도해도
//     결과가 같고(stop), 요청 만료는 처음부터(restart), 형식 오류는 입력만 고치면
//     된다(fix). 오류 문구만 띄우고 끝내지 않는다.
//  3. 공급자로 보내는 길은 서버가 준 redirectUrl 하나뿐이다. 지금 공급자는 mock이라
//     그 주소가 개발 경로(/api/v2/dev/...)이고, 그때만 화면에서 값을 직접 받는다.
//     실제 공급자가 붙으면 같은 자리에서 그 주소로 보낸다.

export const ADULT_AGE = 19; // backend/src/identity/identity.js:28

// 개인정보 고지. 저장하는 것은 CI 해시뿐이라는 사실을 화면에서 밝힌다(04-money.md §6).
export const IDENTITY_PRIVACY = [
  '저장하는 것은 연결정보(CI)를 서버 비밀과 섞어 만든 해시뿐입니다.',
  '이름·생년월일·전화번호 원문은 저장하지 않습니다.',
  `확인한 사실(만 ${ADULT_AGE}세 이상 여부)과 확인 시각만 계정에 남습니다.`,
];

export const MOCK_NOTICE = '개발 환경입니다. 실제 본인확인 공급자가 연결되지 않았고, 아래 값은 검증 없이 그대로 서버에 전달됩니다.';

const DEV_PREFIX = '/api/v2/dev/';

/**
 * 구매 흐름에서 본인확인이 어디까지 왔는지.
 *   off      — 서버에 본인확인 경로가 없다(기능 꺼짐). 화면에서 숨긴다.
 *   done     — 확인을 마쳤다. 건너뛴다.
 *   required — 확인해야 결제할 수 있다(FEATURE_IDENTITY_REQUIRED).
 *   optional — 경로는 열려 있지만 결제를 막지는 않는다.
 */
export function identityGate({ supported, identity, required } = {}) {
  if (!supported) return { kind: 'off', blocks: false };
  if (identity?.verified) return { kind: 'done', blocks: false };
  if (required) return { kind: 'required', blocks: true };
  return { kind: 'optional', blocks: false };
}

/** 확인 상태 한 줄 표시. */
export function identitySummary(identity) {
  if (!identity?.verified) {
    return { label: '확인 전', tone: 'wait', detail: '유료 평가를 결제하기 전에 한 번만 확인하면 됩니다.' };
  }
  return {
    label: '확인 완료',
    tone: 'ok',
    detail: `만 ${ADULT_AGE}세 이상 확인됨 · 공급자 ${identity.provider ?? '알 수 없음'}`,
  };
}

/**
 * start 응답을 어디로 보낼지. 주소는 서버가 준 것만 쓰고, 그중에서도
 * https 또는 같은 출처의 절대 경로만 링크로 만든다(javascript: 같은 주소 차단).
 */
export function providerHandoff(start) {
  if (start?.alreadyVerified) return { kind: 'verified' };
  const requestId = String(start?.requestId ?? '');
  const url = String(start?.redirectUrl ?? '');
  if (!requestId || !url) {
    return { kind: 'error', text: '본인확인 요청을 받지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (url.startsWith(DEV_PREFIX)) return { kind: 'mock', requestId, url };
  if (url.startsWith('https://') || url.startsWith('/')) return { kind: 'redirect', requestId, url };
  return { kind: 'error', text: '본인확인 공급자 주소를 쓸 수 없습니다. 운영자에게 알려 주세요.' };
}

/**
 * complete 실패를 "다음에 할 일"까지 붙여 읽는다.
 *   next: 'stop' 다시 시도해도 같다 · 'restart' 처음부터 · 'fix' 입력만 고치면 됨 · 'done' 이미 끝남
 */
export function completeFailure(result) {
  const code = result?.ok ? null : result?.code ?? 'internal';
  const message = result?.message ?? '서버 오류가 발생했습니다.';
  switch (code) {
    case 'not_adult':
      // 다시 해도 같은 답이 온다(공급자가 보내는 생년월일은 사용자가 못 바꾼다).
      // 다만 다른 사람의 확인이 잘못 전달된 경우가 있어 다시 시작할 길은 남긴다.
      return {
        kind: 'not_adult',
        next: 'stop',
        retry: true,
        title: `만 ${ADULT_AGE}세 미만은 유료 평가를 이용할 수 없습니다`,
        text: `만 나이는 생일이 지나야 오릅니다. 만 ${ADULT_AGE}세가 된 뒤에 다시 확인해 주세요. 결제 주문은 만들어지지 않았습니다.`,
      };
    case 'identity_taken':
      return {
        kind: 'identity_taken',
        next: 'stop',
        title: '이미 다른 계정에서 사용된 본인확인 정보입니다',
        text: '한 사람은 계정 하나만 쓸 수 있습니다. 어느 계정이 쓰고 있는지는 알려 드리지 않습니다(다른 사람의 계정 존재를 노출하지 않기 위해서입니다). 기존 계정으로 로그인하거나 고객센터로 문의해 주세요.',
      };
    case 'already_verified':
      return {
        kind: 'already_verified',
        next: 'done',
        title: '이 계정은 이미 본인확인을 마쳤습니다',
        text: '확인한 사람을 다른 사람으로 바꿀 수는 없습니다. 그대로 결제를 이어서 진행할 수 있습니다.',
      };
    case 'verification_failed':
      return {
        kind: 'verification_failed',
        next: 'restart',
        title: '본인확인 결과를 확인하지 못했습니다',
        text: '요청이 만료됐거나 결과가 올바르지 않습니다. 본인확인을 처음부터 다시 시작해 주세요.',
      };
    case 'validation_failed':
      return { kind: 'validation_failed', next: 'fix', title: '입력한 값을 확인해 주세요', text: message };
    case 'unauthorized':
      return { kind: 'unauthorized', next: 'stop', title: '로그인이 필요합니다', text: '로그인한 뒤 다시 시도해 주세요.' };
    case 'offline':
      return { kind: 'offline', next: 'fix', title: '서버에 연결할 수 없습니다', text: '연결을 확인한 뒤 다시 보내 주세요. 같은 요청 번호로 다시 보낼 수 있습니다.' };
    default:
      return { kind: 'error', next: 'restart', title: '본인확인을 마치지 못했습니다', text: message };
  }
}

/**
 * 결제가 본인확인 때문에 막혔는지. 막혔으면 무엇을 해야 하는지까지 돌려준다
 * (backend/src/identity/identity.js:94-98의 게이트가 만드는 403).
 */
export function identityBlock(result) {
  if (result?.ok) return null;
  if (result.code === 'identity_required') {
    return {
      kind: 'identity_required',
      text: '유료 평가는 본인확인을 마친 뒤에 결제할 수 있습니다. 결제는 진행되지 않았습니다.',
      action: '본인확인 하러 가기',
    };
  }
  if (result.code === 'not_adult') {
    return {
      kind: 'not_adult',
      text: `만 ${ADULT_AGE}세 이상만 유료 평가를 이용할 수 있습니다. 결제는 진행되지 않았습니다.`,
      action: '본인확인 상태 보기',
    };
  }
  return null;
}
