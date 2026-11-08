import {
  placeholderPattern,
  restoreDetailed,
  validateMapping,
} from "../engine/restore.js";

export const emptyStore = () => ({ version: 1, current: null, recent: [] });
export function validateStore(store) {
  if (
    store?.version !== 1 ||
    !Array.isArray(store.recent) ||
    store.recent.length > 10
  )
    throw new Error("mappingError");
  const ids = new Set();
  for (const row of store.recent) {
    if (
      typeof row.id !== "string" ||
      ids.has(row.id) ||
      !Number.isFinite(Date.parse(row.time))
    )
      throw new Error("mappingError");
    ids.add(row.id);
    validateMapping(row.mapping);
  }
  if (store.current !== null && !ids.has(store.current))
    throw new Error("mappingError");
  return store;
}
export function currentMapping(store) {
  return store.recent.find((row) => row.id === store.current)?.mapping;
}
export function commitMapping(store, mapping, id, time) {
  validateMapping(mapping);
  const nextId = store.current || id;
  return validateStore({
    version: 1,
    current: nextId,
    recent: [
      { id: nextId, time, mapping },
      ...store.recent.filter((row) => row.id !== nextId),
    ].slice(0, 10),
  });
}
export function bestRestore(text, store) {
  const tokens = [...text.matchAll(placeholderPattern)].map(
    (match) => match[0],
  );
  if (!tokens.length)
    return { output: text, unknown: [], count: 0, hasTokens: false };
  const rows = [...store.recent].sort(
    (a, b) => Number(b.id === store.current) - Number(a.id === store.current),
  );
  let best;
  for (const row of rows) {
    const result = restoreDetailed(text, row.mapping);
    const count = tokens.filter((token) =>
      Object.hasOwn(row.mapping.placeholders, token),
    ).length;
    if (!best || count > best.count)
      best = { ...result, count, id: row.id, hasTokens: true };
    if (count === tokens.length) break;
  }
  return (
    best || {
      output: text,
      unknown: [...new Set(tokens)],
      count: 0,
      hasTokens: true,
    }
  );
}
