import { detect, categories } from "./detect.js";
import { dictionaryMatches, fold } from "./dictionary.js";
import { makeReport } from "./report.js";
import { placeholderPattern, textHash, validateMapping } from "./restore.js";
export { restore } from "./restore.js";
function normalizedView(raw) {
  if (raw.normalize("NFC") === raw) return { text: raw, toRaw: null };
  let text = "",
    toRaw = [];
  for (const m of raw.matchAll(/[^\p{M}]\p{M}*|\p{M}+/gu)) {
    const n = m[0].normalize("NFC");
    for (let i = 0; i < n.length; i++) toRaw.push(m.index);
    text += n;
    toRaw.push(m.index + m[0].length);
    toRaw.pop();
  }
  toRaw.push(raw.length);
  return { text, toRaw };
}
export function scrubText(raw, policy = {}) {
  if (typeof raw !== "string") throw new Error("Input text must be a string.");
  const { text, toRaw } = normalizedView(raw);
  // Existing [CATEGORY_n] tokens (an AI answer being re-scrubbed) are kept as-is and never re-detected.
  const existing = [...text.matchAll(placeholderPattern)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    category: m[0].slice(1, m[0].lastIndexOf("_")),
    n: +m[0].slice(m[0].lastIndexOf("_") + 1, -1),
  }));
  const d = detect(text, policy.detectors);
  const detectorSpans = d.matches.slice().sort((a, b) => a.start - b.start);
  let furthest = 0;
  const ends = detectorSpans.map((m) => (furthest = Math.max(furthest, m.end)));
  const dict = dictionaryMatches(text, policy.dictionary || []).filter((m) => {
    let lo = 0,
      hi = detectorSpans.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (detectorSpans[mid].start <= m.start) lo = mid + 1;
      else hi = mid;
    }
    return !lo || ends[lo - 1] < m.end;
  });
  const rawIndex = (i) => (toRaw ? toRaw[i] : i);
  const normalizedIndex = (i) => {
    if (!toRaw) return i;
    let lo = 0,
      hi = toRaw.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (toRaw[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const manual = (policy.manual || []).map((m) => {
    if (
      !Number.isInteger(m.start) ||
      !Number.isInteger(m.end) ||
      m.start < 0 ||
      m.end > raw.length ||
      m.start >= m.end ||
      !categories.includes(m.category)
    )
      throw new Error("Invalid manual replacement range/category.");
    const start = normalizedIndex(m.start),
      end = normalizedIndex(m.end);
    return { ...m, start, end, rank: -1, value: text.slice(start, end) };
  });
  const kept = new Set((policy.keep || []).map((m) => m.start + ":" + m.end));
  const all = [...d.matches, ...dict, ...manual].filter(
    (m) => !kept.has(rawIndex(m.start) + ":" + rawIndex(m.end)),
  );
  // Longest first, then detector order; occupancy avoids quadratic interval insertion.
  const sorted = all.sort(
      (a, b) =>
        b.end - b.start - (a.end - a.start) ||
        a.rank - b.rank ||
        a.start - b.start,
    ),
    accepted = [];
  const occupied = new Uint8Array(text.length);
  for (const e of existing) occupied.fill(1, e.start, e.end);
  for (const m of sorted) {
    let conflict = false;
    for (let i = m.start; i < m.end; i++)
      if (occupied[i]) {
        conflict = true;
        break;
      }
    if (conflict) continue;
    occupied.fill(1, m.start, m.end);
    accepted.push(m);
  }
  accepted.sort((a, b) => a.start - b.start);

  const mapping = { version: 1, placeholders: {} },
    keys = new Map(),
    numbers = {};
  // Continuation copies only canonical entries. Exact-output variants belong to this run,
  // not an earlier paste; never mutate a caller's conversation mapping.
  if (policy.mapping !== undefined) {
    validateMapping(policy.mapping);
    const dictionaryTerms = new Set((policy.dictionary || []).map((e) => e.category + ":" + fold(e.term.trim())));
    for (const [p, entry] of Object.entries(policy.mapping.placeholders)) {
      const n = Number(p.slice(p.lastIndexOf("_") + 1, -1));
      if (!Number.isSafeInteger(n) || n >= Number.MAX_SAFE_INTEGER)
        throw new Error("Mapping placeholder number is out of range.");
      mapping.placeholders[p] = { value: entry.value, category: entry.category };
      numbers[entry.category] = Math.max(numbers[entry.category] || 0, n);
      let normalized = entry.value.normalize("NFC");
      if (entry.category === "EMAIL") normalized = normalized.toLowerCase();
      if (entry.category === "PHONE") normalized = normalized.replace(/\D/g, "");
      if (entry.category === "IBAN") normalized = normalized.replace(/\s/g, "").toUpperCase();
      if (entry.category === "CARD") normalized = normalized.replace(/[ -]/g, "");
      const key = entry.category + ":" + normalized;
      if (!keys.has(key)) keys.set(key, p);
      const dictionaryKey = entry.category + ":" + fold(entry.value);
      if (dictionaryTerms.has(dictionaryKey) && !keys.has(dictionaryKey)) keys.set(dictionaryKey, p);
    }
  }
  // New placeholders never collide with ones already present in the input.
  for (const e of existing) numbers[e.category] = Math.max(numbers[e.category] || 0, e.n);
  const
    ord = {},
    variants = [],
    parts = [];
  let last = 0;
  for (const m of accepted) {
    const start = toRaw ? toRaw[m.start] : m.start,
      end = toRaw ? toRaw[m.end] : m.end;
    const value = raw.slice(start, end);
    let normalized = m.key || m.value.normalize("NFC");
    if (m.category === "EMAIL") normalized = normalized.toLowerCase();
    if (m.category === "PHONE") normalized = normalized.replace(/\D/g, "");
    if (m.category === "IBAN")
      normalized = normalized.replace(/\s/g, "").toUpperCase();
    if (m.category === "CARD") normalized = normalized.replace(/[ -]/g, "");
    if (m.key) normalized = fold(m.key);
    const key = m.category + ":" + normalized;
    let p = keys.get(key);
    if (!p) {
      p =
        "[" +
        m.category +
        "_" +
        (numbers[m.category] = (numbers[m.category] || 0) + 1) +
        "]";
      keys.set(key, p);
      mapping.placeholders[p] = {
        // Dictionary matches record the canonical term, so an alias or a differently cased mention restores
        // to the dictionary entry; the exact surface form of every occurrence is kept in variants.
        value: (m.key || m.value).normalize("NFC"),
        category: m.category,
      };
    }
    const ordinal = ord[p] || 0;
    ord[p] = ordinal + 1;
    if (value !== mapping.placeholders[p].value)
      variants.push({ placeholder: p, ordinal, value });
    parts.push(raw.slice(last, start), p);
    last = end;
    m.placeholder = p;
    m.rawStart = start;
    m.rawEnd = end;
  }
  parts.push(raw.slice(last));
  const output = parts.join("");
  if (variants.length) {
    mapping.variants = variants;
    mapping.outputHash = textHash(output);
  }
  if (existing.length)
    mapping.keptPlaceholders = existing.length;
  return {
    output,
    mapping,
    report: makeReport(
      accepted,
      d.review.map((r) => ({
        ...r,
        offset: rawIndex(r.offset),
        text: raw.slice(rawIndex(r.offset), rawIndex(r.offset + r.text.length)),
      })),
      raw.length,
      output.length,
      existing.length ? [existing.length + " existing placeholders kept as-is"] : [],
    ),
    matches: accepted.map((m) => ({ ...m, start: m.rawStart, end: m.rawEnd })),
    inputText: raw,
  };
}
export async function scrub(input, policy = {}, env = {}) {
  if (input?.kind === "text") return scrubText(input.text, policy);
  if (input?.kind === "docx") {
    const { scrubDocx } = await import("./docx.js");
    return scrubDocx(input.bytes, policy);
  }
  throw new Error("Supported input kinds are text and docx.");
}
