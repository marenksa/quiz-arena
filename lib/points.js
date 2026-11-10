// The scoring rule. Kept in one place so it is easy to change.
// - correct on the very first try at a question: +10
// - correct after having missed it before (only until the first time you get it right): +5
// - correct again on a question you have already got right: +1
// - wrong: 0
export function pointsFor({ correct, previousAttempts, everCorrect }) {
  if (!correct) return 0;
  if (previousAttempts === 0) return 10;
  if (!everCorrect) return 5;
  return 1;
}
