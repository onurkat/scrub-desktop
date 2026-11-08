export const placeholderPattern =
  /\[(?:PERSON|ORG|EMAIL|PHONE|IBAN|CARD|ID|SECRET|URL|ADDRESS|MONEY|TERM)_\d+\]/g;
// 64-bit FNV-1a over UTF-16 code units, hex; identifies the exact scrubbed text without storing it.
export function textHash(text) {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x01000193) >>> 0;
  }
  return text.length.toString(16) + "-" + h1.toString(16) + h2.toString(16);
}
export function isExactOutput(mapping, text) {
  if (mapping.outputHash) return mapping.outputHash === textHash(text);
  return mapping.exactOutput !== undefined && mapping.exactOutput === text;
}
export function validateMapping(mapping) {
  if (
    !mapping ||
    mapping.version !== 1 ||
    !mapping.placeholders ||
    typeof mapping.placeholders !== "object" ||
    Array.isArray(mapping.placeholders)
  )
    throw new Error("Mapping must have version 1 and a placeholders object.");
  for (const [k, v] of Object.entries(mapping.placeholders)) {
    if (
      !/^\[(PERSON|ORG|EMAIL|PHONE|IBAN|CARD|ID|SECRET|URL|ADDRESS|MONEY|TERM)_[1-9]\d*\]$/.test(
        k,
      ) ||
      !v ||
      typeof v.value !== "string" ||
      v.category !== k.slice(1, k.lastIndexOf("_"))
    )
      throw new Error("Invalid mapping entry: " + k);
  }
  return mapping;
}
export function restoreDetailed(text, mapping) {
  validateMapping(mapping);
  const unknown = new Set(),
    ord = {};
  const exact = isExactOutput(mapping, text);
  const variants = new Map(
    (exact ? mapping.variants || [] : []).map((v) => [
      v.placeholder + ":" + v.ordinal,
      v.value,
    ]),
  );
  const output = text.replace(placeholderPattern, (p) => {
    const e = mapping.placeholders[p];
    if (!e) {
      unknown.add(p);
      return p;
    }
    const n = ord[p] || 0;
    ord[p] = n + 1;
    return variants.get(p + ":" + n) ?? e.value;
  });
  return { output, unknown: [...unknown] };
}
export function restore(text, mapping) {
  return restoreDetailed(text, mapping).output;
}
