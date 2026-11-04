import { calculateResetScenario } from './reset-scenario.js';

const form = document.querySelector('#reset-form');
const error = document.querySelector('#reset-error');
const results = document.querySelector('#reset-results');
const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatMoney = cents => currency.format(cents / 100);
const formatRemaining = cents => `${cents > 0 ? '+' : ''}${formatMoney(cents)}`;
const setText = (id, text) => { document.getElementById(id).textContent = text; };

function renderComparison(when, risk) {
  setText(`reset-${when}-equity`, formatMoney(risk.dailyFloor + risk.dailyRemaining));
  for (const [name, floor, remaining] of [
    ['daily', risk.dailyFloor, risk.dailyRemaining],
    ['max', risk.maxFloor, risk.maxRemaining],
  ]) {
    setText(`reset-${when}-${name}-floor`, formatMoney(floor));
    setText(`reset-${when}-${name}-remaining`, formatRemaining(remaining));
    setText(`reset-${when}-${name}-status`, remaining < 0
      ? '현재 자산이 한도 아래'
      : remaining === 0 ? '현재 자산이 한도와 정확히 같음' : '현재 자산이 한도 위');
    document.getElementById(`reset-${when}-${name}-status`).classList.toggle('below-limit', remaining < 0);
  }
}

function updateScenario() {
  let scenario;
  try {
    scenario = calculateResetScenario(Object.fromEntries(new FormData(form)));
  } catch {
    error.textContent = '입력 금액과 계산 결과의 범위를 확인해 주세요. 금액은 0 이상의 숫자로 소수점 둘째 자리까지 입력할 수 있습니다.';
    error.hidden = false;
    results.hidden = true;
    return;
  }

  renderComparison('before', scenario.before);
  renderComparison('after', scenario.after);
  error.hidden = true;
  results.hidden = false;
}

form.addEventListener('input', updateScenario);
form.addEventListener('submit', event => event.preventDefault());
updateScenario();
