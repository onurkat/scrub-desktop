import { categories } from "./detect.js";
export const fold = (s) =>
  s.normalize("NFC").replace(/[İı]/g, "i").toLowerCase();
const word = (c) => !!c && /[\p{L}\p{N}_\p{M}]/u.test(c);
export function normalizeDictionary(entries = []) {
  if (!Array.isArray(entries) || entries.length > 10000)
    throw new Error("Dictionary must contain at most 10,000 entries.");
  return entries.map((e) => {
    if (!e || typeof e.term !== "string" || !e.term.trim())
      throw new Error("Every dictionary term must be nonempty text.");
    const term = e.term.trim().normalize("NFC");
    if (term.length > 500)
      throw new Error("Dictionary terms must be 500 characters or fewer.");
    if (e.aliases && !Array.isArray(e.aliases))
      throw new Error("Aliases must be an array.");
    return {
      term,
      category: categories.includes(e.category) ? e.category : "TERM",
      aliases: (e.aliases || [])
        .map((a) => {
          if (typeof a !== "string" || a.length > 500)
            throw new Error("Invalid alias.");
          return a.trim().normalize("NFC");
        })
        .filter(Boolean),
    };
  });
}
export function dictionaryMatches(text, entries = []) {
  const dict = normalizeDictionary(entries),
    root = { next: new Map(), out: [] },
    matches = [];
  // A trie scans up to the longest (bounded) dictionary term at each character, without regex interpolation.
  for (const e of dict)
    for (const term of [e.term, ...e.aliases]) {
      let n = root;
      for (const c of fold(term).replace(/\s+/g, " ")) {
        if (!n.next.has(c)) n.next.set(c, { next: new Map(), out: [] });
        n = n.next.get(c);
      }
      n.out.push({
        e,
        term,
        // Mixed case inside a word (iPhone, McDonald) is significant; Title Case across words is not.
        sensitive: term.split(/\s+/).some((w) => /\p{Ll}\p{Lu}/u.test(w)),
      });
    }
  const chars = [...text],
    offsets = [];
  let offset = 0;
  for (const c of chars) {
    offsets.push(offset);
    offset += c.length;
  }
  offsets.push(offset);
  for (let i = 0; i < chars.length; i++) {
    if (word(chars[i - 1])) continue;
    let n = root;
    for (let j = i; j < chars.length && j < i + 600; j++) {
      const fc = fold(chars[j]);
      if (/\s/.test(fc)) {
        // Any whitespace run (double space, line break in justified DOCX text) matches one dictionary space.
        if (j > i && /\s/.test(fold(chars[j - 1]))) continue;
        n = n.next.get(" ");
      } else n = n.next.get(fc);
      if (!n) break;
      if (!n.out.length) continue;
      const end = offsets[j + 1];
      let boundary = !word(chars[j + 1]);
      if (!boundary) {
        const suffix = text.slice(end, end + 3);
        boundary = /^(?:s|es)(?![\p{L}\p{N}_])/u.test(suffix);
      }
      if (!boundary) continue;
      const value = text.slice(offsets[i], end);
      for (const x of n.out)
        if (!x.sensitive || value.replace(/\s+/g, " ") === x.term.replace(/\s+/g, " "))
          matches.push({
            start: offsets[i],
            end,
            value,
            category: x.e.category,
            rank: 20,
            key: x.e.term,
          });
    }
  }
  // A host dictionary entry anonymizes the complete URL, not only its host.
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    try {
      const host = new URL(m[0]).hostname;
      const e = dict.find((e) =>
        [e.term, ...e.aliases].some((t) => fold(t) === fold(host)),
      );
      if (e)
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          value: m[0],
          category: "URL",
          rank: 6,
        });
    } catch {
      /* Malformed URLs are not interpreted as hosts. */
    }
  }
  return matches;
}
export function parseCSV(text) {
  const rows = [],
    row = [];
  let value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') {
      if (value) throw new Error("Unexpected quote in CSV.");
      quoted = true;
    } else if (c === ",") {
      row.push(value);
      value = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push([...row]);
      row.length = 0;
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
export function importDictionary(text) {
  const rows = parseCSV(text.replace(/^\uFEFF/, ""));
  if (rows.shift()?.join(",").toLowerCase() !== "term,category,aliases")
    throw new Error("CSV header must be term,category,aliases.");
  return normalizeDictionary(
    rows
      .filter((r) => r.some(Boolean))
      .map((r) => {
        if (r.length !== 3)
          throw new Error("Dictionary CSV needs three columns.");
        return {
          term: r[0].replace(/^'(?=[=+\-@])/, ""),
          category: r[1],
          aliases: r[2] ? r[2].split("|").map((a) => a.replace(/^'(?=[=+\-@])/, "")) : [],
        };
      }),
  );
}
export function exportDictionary(entries) {
  // Cells that start like a spreadsheet formula get a leading apostrophe (CSV injection guard).
  const esc = (s) =>
    '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
  return (
    "term,category,aliases\r\n" +
    normalizeDictionary(entries)
      .map((e) => [e.term, e.category, e.aliases.join("|")].map(esc).join(","))
      .join("\r\n")
  );
}
