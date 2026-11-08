export function makeReport(
  matches,
  review,
  inputChars,
  outputChars,
  skipped = [],
) {
  const counts = {},
    by = new Map();
  for (const m of matches) {
    counts[m.category] = (counts[m.category] || 0) + 1;
    if (!by.has(m.placeholder))
      by.set(m.placeholder, {
        placeholder: m.placeholder,
        category: m.category,
        occurrences: 0,
      });
    by.get(m.placeholder).occurrences++;
  }
  return {
    counts,
    replaced: [...by.values()],
    review,
    skipped,
    inputChars,
    outputChars,
  };
}
