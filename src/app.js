import { calculateRisk } from './risk.js';

const form = document.querySelector('#risk-form');
const error = document.querySelector('#form-error');
const results = document.querySelector('#results');
const primary = document.querySelector('#primary-result');
const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatMoney = cents => currency.format(cents / 100);
const formatRemaining = cents => `${cents > 0 ? '+' : ''}${formatMoney(cents)}`;
const setText = (id, text) => { document.getElementById(id).textContent = text; };

function updateResults() {
  const input = Object.fromEntries(new FormData(form));
  let risk;
  try {
    risk = calculateRisk(input);
  } catch (issue) {
    error.textContent = issue instanceof Error ? issue.message : '입력값을 확인해 주세요.';
    error.hidden = false;
    results.hidden = true;
    return;
  }

  error.hidden = true;
  results.hidden = false;
  const breached = risk.limitingRemaining <= 0;
  const rule = { daily: '일일 손실 한도', maximum: '최대 손실 한도', both: '일일 및 최대 손실 한도' }[risk.limitingRule];
  primary.classList.toggle('at-boundary', breached);
  setText('status-pill', breached ? '한도 도달 가능성' : '한도까지 여유');
  setText('limiting-remaining', formatRemaining(risk.limitingRemaining));
  setText('limiting-caption', breached
    ? `${rule}에 도달했거나 초과했을 가능성이 있습니다.`
    : `${rule}가 가장 가까운 한도입니다.`);
  setText('daily-floor', formatMoney(risk.dailyFloor));
  setText('max-floor', formatMoney(risk.maxFloor));
  setText('daily-remaining', formatRemaining(risk.dailyRemaining));
  setText('max-remaining', formatRemaining(risk.maxRemaining));
}

form.addEventListener('input', updateResults);
form.addEventListener('submit', event => event.preventDefault());
updateResults();
