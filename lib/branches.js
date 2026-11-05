/** Display and input compatibility for the renamed academic branch.
 * Keep this limited to complete branch labels, never free text or subjects.
 */
export const AI_ML_BRANCH = 'AI & ML';
export const LEGACY_AI_DS_BRANCH = 'Artificial Intelligence & Data Science';

const AI_BRANCH_KEYS = new Set([
  'aids', 'aiandds', 'aidatascience', 'aianddatascience',
  'artificialintelligencedatascience', 'artificialintelligenceanddatascience',
  'aiml', 'aiandml', 'aimachinelearning', 'aiandmachinelearning',
  'artificialintelligencemachinelearning', 'artificialintelligenceandmachinelearning',
]);

export function normalizeBranch(value) {
  if (typeof value !== 'string') return value;
  const key = value.toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, '');
  return AI_BRANCH_KEYS.has(key) ? AI_ML_BRANCH : value;
}

/** The historical selector's stored value remains queryable during rollout. */
export function branchFilterValues(value) {
  const normalized = normalizeBranch(value);
  return normalized === AI_ML_BRANCH ? [AI_ML_BRANCH, LEGACY_AI_DS_BRANCH] : [normalized];
}
