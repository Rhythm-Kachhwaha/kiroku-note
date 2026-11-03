const SUMMARY_KEYS = [
  'total_questions_attempted',
  'total_correct',
  'overall_accuracy',
  'total_time_spent_ms',
  'average_time_per_question_ms',
  'current_streak',
  'longest_streak',
  'streak'
];

const LABEL_OVERRIDES = {
  total_questions_attempted: 'Questions',
  total_correct: 'Correct',
  overall_accuracy: 'Accuracy',
  total_time_spent_ms: 'Total time',
  average_time_per_question_ms: 'Average time',
  current_streak: 'Current streak',
  longest_streak: 'Longest streak',
  streak: 'Streak'
};

export function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number % 1 === 0 ? number : number.toFixed(1)}%` : '—';
}

export function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export function formatMetricLabel(key) {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getProgressMetrics(summary = {}) {
  return SUMMARY_KEYS
    .filter((key) => summary[key] !== undefined && summary[key] !== null)
    .map((key) => ({
      key,
      label: formatMetricLabel(key),
      value: key.includes('accuracy') ? formatPercent(summary[key]) :
        key.includes('_time_') ? formatDuration(summary[key]) : String(summary[key])
    }));
}

export function hasProgressHistory(overview = {}, weakAreas = []) {
  const summary = overview?.learning_summary || {};
  const hasSummaryValue = SUMMARY_KEYS.some((key) => Number(summary[key]) > 0);
  return hasSummaryValue ||
    (overview?.accuracy_by_level?.length || 0) > 0 ||
    (overview?.accuracy_by_family?.length || 0) > 0 ||
    (overview?.recent_activity?.length || 0) > 0 ||
    (Array.isArray(weakAreas) && weakAreas.length > 0);
}
