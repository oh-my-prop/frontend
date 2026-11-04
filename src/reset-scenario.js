import { calculateRisk } from './risk.js';

/** Illustrate fixed 5% and 10% floors before and after a balance reset. */
export function calculateResetScenario(input) {
  if (!input || typeof input !== 'object') {
    // Delegate input validation to the existing calculator.
    calculateRisk(input);
  }

  const common = {
    initialBalance: input.initialBalance,
    currentEquity: input.currentEquity,
    dailyLossPercent: '5',
    maxLossPercent: '10',
  };

  return {
    before: calculateRisk({ ...common, dailyStartEquity: input.previousResetBalance }),
    after: calculateRisk({ ...common, dailyStartEquity: input.newResetBalance }),
  };
}
