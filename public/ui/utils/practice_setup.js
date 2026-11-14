export function getEligibleQuestionCount(summary, level, category = 'all', formatCode = 'all') {
  const levelData = summary?.levels?.[level];
  if (!levelData) return 0;

  if (category === 'all' && formatCode === 'all') {
    return Number(levelData.eligible_count) || 0;
  }

  return (Array.isArray(levelData.formats) ? levelData.formats : [])
    .filter((item) => (category === 'all' || item.category === category)
      && (formatCode === 'all' || item.format_code === formatCode))
    .reduce((total, item) => total + (Number(item.eligible_count) || 0), 0);
}
