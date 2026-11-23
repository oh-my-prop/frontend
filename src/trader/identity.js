// 본인확인 화면 (유료 평가 결제 앞단계, backend/docs/prop/04-money.md §6).
// DOM은 createElement/textContent로만 만들고 인라인 스타일을 쓰지 않는다(CSP).
//
// 화면이 지키는 것:
//  1. 서버가 본인확인 경로를 열지 않았으면(404) 이 화면도 구매 화면의 안내도 없다.
//     구매 흐름은 그대로 돌아간다.
//  2. 지금 공급자는 mock이고 **아무것도 검증하지 않는다**. 그래서 진짜 본인확인
//     창처럼 보이게 만들지 않는다. 개발 도구 영역으로 분명히 표시하고, 실제 공급자가
//     붙으면 같은 자리에서 서버가 준 redirectUrl로 보낸다(providerHandoff).
//  3. 실패는 사유마다 다음에 할 일이 다르다. 문구만 띄우지 않고 그 다음 버튼까지 둔다.

import * as api from './api.js';
import { el } from '../site/dom.js';
import { formatTimestamp } from './format.js';
import {
  IDENTITY_PRIVACY, MOCK_NOTICE, completeFailure, identityGate, identitySummary, providerHandoff,
} from './identity-view.js';

const $ = (id) => document.getElementById(id);

const state = {
  supported: null, // null이면 아직 확인 전, false면 서버에 경로가 없다
  identity: null,
  required: false,
  phase: 'intro', // intro | handoff | done
  handoff: null,
  failure: null,
  busy: false,
  message: null, // { tone, text }
  resume: null, // 확인을 마친 뒤 돌아갈 곳(구매 화면)
  form: { ci: '', birthDate: '' }, // mock 폼에 적은 값(다시 그려도 날아가지 않게)
  loading: null,
};

let hooks = { closeOthers: () => {} };

export function initIdentity(options) {
  hooks = { ...hooks, ...options };
}

/** 로그인한 사용자가 바뀌면 이전 사용자의 확인 상태를 들고 있으면 안 된다. */
export function resetIdentity() {
  state.supported = null;
  state.identity = null;
  state.required = false;
  state.phase = 'intro';
  state.handoff = null;
  state.failure = null;
  state.message = null;
  state.form = { ci: '', birthDate: '' };
  state.loading = null;
}

/** 본인확인 상태를 한 번만 읽어 둔다. 404·연결 실패면 기능이 없는 것으로 본다. */
export async function ensureIdentity() {
  if (state.supported === null) {
    state.loading ??= api.getIdentity().then((result) => {
      if (result.ok) {
        state.supported = true;
        state.identity = result.identity ?? null;
        state.required = Boolean(result.required);
      } else if (result.code !== 'unauthorized') {
        // 404(기능 꺼짐)도, 연결 실패도 "이 화면에서는 본인확인이 없다"로 같다.
        state.supported = false;
      }
      state.loading = null;
    });
    await state.loading;
  }
  return identityGate(state);
}

export const identityGateNow = () => identityGate(state);
export const identityVerified = () => Boolean(state.identity?.verified);

export function closeIdentity() {
  $('identity').hidden = true;
}

/** 본인확인 화면을 연다. `resume`은 확인을 마친 뒤 돌아갈 곳(보통 구매 화면). */
export async function openIdentity({ resume = null } = {}) {
  hooks.closeOthers();
  $('identity').hidden = false;
  state.resume = resume;
  state.failure = null;
  state.message = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await ensureIdentity();
  if (state.supported === false) {
    // 보던 사이에 기능이 꺼진 서버로 바뀐 경우. 조용히 닫고 원래 흐름으로 돌려보낸다.
    closeIdentity();
    state.resume?.();
    return;
  }
  if (state.identity?.verified) state.phase = 'done';
  render();
  focusMain();
}

/** 서버 상태를 다시 읽는다. 결제가 본인확인으로 막혔을 때처럼 캐시가 낡았을 때 쓴다. */
export async function refreshIdentity() {
  if (state.supported === false) return { ok: false, code: 'not_found' };
  const result = await api.getIdentity();
  if (result.ok) {
    state.supported = true;
    state.identity = result.identity ?? null;
    state.required = Boolean(result.required);
  } else if (result.code !== 'unauthorized') state.supported = false;
  return result;
}

// ---- actions -----------------------------------------------------------------------

async function startFlow() {
  if (state.busy) return;
  state.busy = true;
  state.message = null;
  state.failure = null;
  render();
  const result = await api.startIdentity();
  state.busy = false;
  if (!result.ok) {
    const failure = completeFailure(result);
    state.failure = failure;
    render();
    return;
  }
  if (result.alreadyVerified) {
    await refreshIdentity();
    state.phase = 'done';
    render();
    focusMain();
    return;
  }
  const handoff = providerHandoff(result);
  if (handoff.kind === 'error') {
    state.message = { tone: 'warning', text: handoff.text };
    render();
    return;
  }
  state.handoff = handoff;
  state.phase = 'handoff';
  render();
  focusMain();
}

/** 개발 공급자(mock) 영수증 제출. 실제 공급자라면 이 자리는 공급자 창이다. */
async function submitMock(event) {
  event.preventDefault();
  if (state.busy || !state.handoff?.requestId) return;
  const ci = $('identity-ci').value.trim();
  const birthDate = $('identity-birth').value.trim();
  state.form = { ci, birthDate }; // 다시 그려도 입력이 날아가지 않게 둔다
  state.busy = true;
  state.failure = null;
  state.message = null;
  render();
  const result = await api.completeIdentity({ requestId: state.handoff.requestId, ci, birthDate });
  state.busy = false;
  if (result.ok) {
    state.identity = result.identity ?? null;
    state.form = { ci: '', birthDate: '' }; // 확인이 끝나면 화면에 들고 있지 않는다
    state.phase = 'done';
    render();
    focusMain();
    return;
  }
  const failure = completeFailure(result);
  state.failure = failure;
  if (failure.next === 'done') {
    // 이미 확인된 계정이다. 상태를 다시 읽고 결제로 이어 주는 것이 맞다.
    await refreshIdentity();
    state.phase = 'done';
  }
  if (failure.next === 'restart' || failure.next === 'stop') {
    // 공급자 요청은 이미 소진됐다(mock-identity.js:36). 폼을 남겨 두면 안 된다.
    state.handoff = null;
    state.phase = 'intro';
  }
  render();
  focusMain();
}

function restart() {
  state.handoff = null;
  state.failure = null;
  state.message = null;
  state.phase = 'intro';
  render();
  focusMain();
}

function goBack() {
  closeIdentity();
  state.resume?.();
}

function focusMain() {
  const target = document.querySelector('#identity-body [data-focus]');
  if (target) target.focus();
}

// ---- rendering ----------------------------------------------------------------------

function render() {
  const message = $('identity-message');
  message.textContent = state.message?.text ?? '';
  message.dataset.tone = state.message?.tone ?? '';
  message.hidden = !state.message;

  const body = $('identity-body');
  if (state.supported === null) {
    body.replaceChildren(el('p', { class: 'muted', text: '본인확인 상태를 불러오는 중…' }));
    return;
  }
  body.replaceChildren(statusPanel(), ...stepPanels());
}

function statusPanel() {
  const summary = identitySummary(state.identity);
  return el('section', { class: 'panel identity-panel' },
    el('div', { class: 'identity-top' },
      el('span', { class: 'status-pill', 'data-tone': summary.tone === 'ok' ? null : 'wait', text: summary.label }),
      state.required ? el('span', { class: 'muted small', text: '유료 평가 결제에 필요합니다' }) : el('span', { class: 'muted small', text: '지금은 결제를 막지 않습니다' }),
    ),
    el('p', { class: 'muted', text: summary.detail }),
    state.identity?.verifiedAt ? el('p', { class: 'muted small', text: `확인 시각 ${formatTimestamp(state.identity.verifiedAt)}` }) : null,
    el('div', { class: 'policy' },
      el('h3', { text: '무엇이 저장되나요' }),
      el('ul', { class: 'rule-list' }, IDENTITY_PRIVACY.map((line) => el('li', {}, el('span', { text: line })))),
      el('p', { class: 'field-help' },
        el('a', { class: 'link-btn', href: '/legal/privacy.html', text: '개인정보 처리방침 보기' })),
    ),
  );
}

function stepPanels() {
  const panels = [];
  if (state.failure) panels.push(failurePanel(state.failure));
  // 더 해 볼 것이 없는 실패(미성년·중복)에서는 시작 버튼을 다시 내놓지 않는다.
  // 다음에 할 일은 실패 칸 안에만 둔다.
  if (state.failure?.next === 'stop') return panels;
  if (state.phase === 'done') panels.push(donePanel());
  else if (state.phase === 'handoff' && state.handoff) panels.push(handoffPanel(state.handoff));
  else panels.push(introPanel());
  return panels;
}

function introPanel() {
  const start = el('button', {
    class: 'primary-btn', type: 'button', 'data-focus': true, id: 'identity-start',
    text: '본인확인 시작', onclick: startFlow,
  });
  start.disabled = state.busy;
  return el('section', { class: 'panel identity-panel', 'aria-labelledby': 'identity-start-title' },
    el('h2', { id: 'identity-start-title', text: '확인 절차' }),
    el('ol', { class: 'how-steps' },
      el('li', {}, el('span', { text: '1' }), el('div', {}, el('strong', { text: '본인확인 시작' }), el('p', { text: '공급자 화면으로 이동합니다.' }))),
      el('li', {}, el('span', { text: '2' }), el('div', {}, el('strong', { text: '휴대폰 본인확인' }), el('p', { text: '공급자가 이름·생년월일을 확인합니다.' }))),
      el('li', {}, el('span', { text: '3' }), el('div', {}, el('strong', { text: '구매 계속' }), el('p', { text: '확인이 끝나면 결제 화면으로 돌아옵니다.' }))),
    ),
    start,
    state.busy ? el('p', { class: 'muted small', text: '처리 중…' }) : null,
    state.resume ? el('button', { class: 'ghost-btn', type: 'button', text: '구매 화면으로 돌아가기', onclick: goBack }) : null,
  );
}

function handoffPanel(handoff) {
  if (handoff.kind === 'redirect') {
    return el('section', { class: 'panel identity-panel' },
      el('h2', { text: '공급자 화면으로 이동' }),
      el('p', { class: 'muted', text: '본인확인 공급자 화면에서 확인을 마치면 이 화면으로 돌아옵니다.' }),
      el('a', { class: 'primary-btn link-btn', 'data-focus': true, href: handoff.url, text: '본인확인 창 열기' }),
      el('p', { class: 'muted small', text: `요청 번호 ${handoff.requestId}` }),
      el('button', { class: 'ghost-btn', type: 'button', text: '확인을 마쳤습니다 — 상태 새로고침', onclick: async () => { await refreshIdentity(); if (state.identity?.verified) state.phase = 'done'; render(); focusMain(); } }),
    );
  }
  // mock 공급자. 진짜 본인확인 창이 아니라는 것을 화면에서 분명히 한다.
  // 형식 오류처럼 고쳐서 다시 보낼 수 있는 실패에서 적은 값이 날아가면 안 된다.
  const ci = el('input', { id: 'identity-ci', type: 'text', autocomplete: 'off', 'data-focus': true, required: true, minlength: '8' });
  ci.value = state.form.ci;
  ci.addEventListener('input', () => { state.form.ci = ci.value; });
  const birth = el('input', { id: 'identity-birth', type: 'date', required: true });
  birth.value = state.form.birthDate;
  birth.addEventListener('input', () => { state.form.birthDate = birth.value; });
  const submit = el('button', { class: 'primary-btn', type: 'submit', text: '확인 결과 보내기' });
  submit.disabled = state.busy;
  const form = el('form', { class: 'identity-form', onsubmit: submitMock },
    el('label', { for: 'identity-ci', text: '연결정보(CI) 문자열 — 8자 이상' }),
    ci,
    el('p', { class: 'field-help', text: '실제 공급자라면 사용자가 입력하지 않는 값입니다. 서버는 이 값의 해시만 저장합니다.' }),
    el('label', { for: 'identity-birth', text: '생년월일' }),
    birth,
    el('p', { class: 'field-help', text: '만 19세 미만이면 서버가 거절합니다. 생년월일 자체는 저장되지 않습니다.' }),
    submit,
  );
  return el('section', { class: 'panel identity-panel' },
    el('h2', { text: '본인확인 (개발 환경)' }),
    el('div', { class: 'dev-pay' },
      el('p', { class: 'dev-pay-tag', text: '개발 도구' }),
      el('p', { class: 'muted small', text: MOCK_NOTICE }),
      el('p', { class: 'muted small', text: `공급자 연결 주소: ${handoff.url}` }),
      form,
    ),
    el('p', { class: 'muted small', text: `요청 번호 ${handoff.requestId}` }),
    el('button', { class: 'ghost-btn', type: 'button', text: '처음부터 다시', onclick: restart }),
  );
}

function donePanel() {
  const next = state.resume
    ? el('button', { class: 'primary-btn', type: 'button', 'data-focus': true, text: '구매 계속하기', onclick: goBack })
    : null;
  return el('section', { class: 'panel identity-panel' },
    el('h2', { text: '본인확인이 끝났습니다' }),
    el('p', { class: 'pay-note', 'data-kind': 'opened', text: '이제 유료 평가를 결제할 수 있습니다. 본인확인은 계정당 한 번만 하면 됩니다.' }),
    next,
  );
}

function failurePanel(failure) {
  const actions = [];
  if (failure.next === 'restart') {
    actions.push(el('button', { class: 'primary-btn', type: 'button', 'data-focus': true, text: '본인확인 다시 시작', onclick: startFlow }));
  } else if (failure.retry) {
    // 같은 사람이라면 결과가 같다. 잘못된 확인이 전달된 경우를 위해서만 남긴다.
    actions.push(el('button', { class: 'ghost-btn', type: 'button', 'data-focus': true, text: '본인확인 다시 하기', onclick: startFlow }));
  }
  if (failure.next === 'stop' && state.resume) {
    actions.push(el('button', { class: 'ghost-btn', type: 'button', text: '구매 화면으로 돌아가기', onclick: goBack }));
  }
  return el('section', { class: 'panel identity-panel identity-failure', role: 'alert', 'data-kind': failure.kind },
    el('h2', { text: failure.title }),
    el('p', { text: failure.text }),
    actions.length ? el('div', { class: 'order-actions' }, actions) : null,
  );
}
