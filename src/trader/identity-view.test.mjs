// 본인확인 화면의 판단 규칙(src/trader/identity-view.js). 잡으려는 버그는
// "구매가 막히거나, 막히지 않아야 할 때 막히거나, 실패 뒤에 길이 끊기는 것"이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { completeFailure, identityBlock, identityGate, providerHandoff } from './identity-view.js';

test('본인확인이 없는 서버에서는 구매를 막지 않는다', () => {
  const gate = identityGate({ supported: false, identity: null, required: true });
  assert.equal(gate.kind, 'off');
  assert.equal(gate.blocks, false);
});

test('확인을 마쳤으면 필수여도 건너뛴다', () => {
  assert.equal(identityGate({ supported: true, identity: { verified: true }, required: true }).kind, 'done');
  assert.equal(identityGate({ supported: true, identity: { verified: false }, required: true }).blocks, true);
  // 경로는 열려 있지만 게이트가 꺼진 서버: 보여 주되 결제를 막지는 않는다.
  assert.deepEqual(identityGate({ supported: true, identity: { verified: false }, required: false }), { kind: 'optional', blocks: false });
});

test('공급자로 보내는 길은 서버가 준 주소뿐이고, 쓸 수 없는 주소는 링크로 만들지 않는다', () => {
  assert.deepEqual(providerHandoff({ requestId: 'idv_1', redirectUrl: '/api/v2/dev/mock/identity?request=idv_1' }), {
    kind: 'mock', requestId: 'idv_1', url: '/api/v2/dev/mock/identity?request=idv_1',
  });
  assert.equal(providerHandoff({ requestId: 'idv_1', redirectUrl: 'https://pass.example/verify?t=1' }).kind, 'redirect');
  assert.equal(providerHandoff({ requestId: 'idv_1', redirectUrl: 'javascript:alert(1)' }).kind, 'error');
  assert.equal(providerHandoff({ requestId: 'idv_1' }).kind, 'error');
  assert.equal(providerHandoff({ alreadyVerified: true }).kind, 'verified');
});

test('실패마다 다음에 할 일이 다르다', () => {
  // 둘 다 다시 해도 결과가 같다. 다만 잘못된 확인이 전달된 경우를 위해 미성년 쪽에만
  // 다시 시도할 길을 남긴다. 중복 확인은 다시 시도해도 답이 없으므로 남기지 않는다.
  assert.equal(completeFailure({ ok: false, code: 'not_adult', status: 403 }).next, 'stop');
  assert.equal(completeFailure({ ok: false, code: 'not_adult', status: 403 }).retry, true);
  assert.equal(completeFailure({ ok: false, code: 'identity_taken', status: 409 }).next, 'stop');
  assert.equal(completeFailure({ ok: false, code: 'identity_taken', status: 409 }).retry, undefined);
  // 이미 확인된 계정은 실패가 아니라 "이미 끝난 것"이다. 결제로 이어져야 한다.
  assert.equal(completeFailure({ ok: false, code: 'already_verified', status: 409 }).next, 'done');
  assert.equal(completeFailure({ ok: false, code: 'verification_failed', status: 400 }).next, 'restart');
  assert.equal(completeFailure({ ok: false, code: 'validation_failed', status: 400, message: '생년월일 형식이 올바르지 않습니다.' }).text, '생년월일 형식이 올바르지 않습니다.');
  assert.equal(completeFailure({ ok: false, code: 'offline', status: 0 }).next, 'fix');
});

test('다른 계정이 쓰고 있다는 사실만 말하고 어느 계정인지는 말하지 않는다', () => {
  const failure = completeFailure({ ok: false, code: 'identity_taken', status: 409 });
  assert.match(failure.text, /알려 드리지 않습니다/);
  assert.doesNotMatch(failure.text, /#\d/);
});

test('본인확인 때문에 막힌 결제만 본인확인으로 보낸다', () => {
  const blocked = identityBlock({ ok: false, code: 'identity_required', status: 403 });
  assert.equal(blocked.kind, 'identity_required');
  assert.ok(blocked.action);
  assert.equal(identityBlock({ ok: false, code: 'rules_version_mismatch', status: 409 }), null);
  assert.equal(identityBlock({ ok: true, orderId: 'ord_1' }), null);
});
