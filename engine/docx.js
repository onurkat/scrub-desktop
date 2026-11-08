import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { scrubText } from "./scrub.js";
import { restoreDetailed, isExactOutput } from "./restore.js";
const allowed =
  /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments|commentsExtended|people)\.xml$/;
function decode(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, v) => {
    if (v[0] === "#") {
      const n =
        v[1].toLowerCase() === "x" ? parseInt(v.slice(2), 16) : +v.slice(1);
      if (n < 0 || n > 0x10ffff) throw new Error("Invalid XML character.");
      return String.fromCodePoint(n);
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[v] ?? all;
  });
}
const encode = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function textModel(xml, base = 0) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("DOCX XML entities/DTDs are unsupported.");
  const prefix =
    /xmlns:([\w]+)=["']http:\/\/schemas.openxmlformats.org\/wordprocessingml\/2006\/main["']/.exec(
      xml,
    )?.[1] || "w";
  // Producers may bind WordprocessingML as the default namespace: un-prefixed element names are then "w:".
  const defaultNs =
    /\sxmlns=["']http:\/\/schemas.openxmlformats.org\/wordprocessingml\/2006\/main["']/.test(
      xml,
    );
  if (!defaultNs && !new RegExp("<" + prefix + ":").test(xml) && /<\w+:body\b|<body\b/.test(xml))
    throw new Error("Unsupported DOCX namespace layout.");
  const tokens = /<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g;
  let text = "",
    nodes = [],
    active = null,
    field = 0;
  const stack = [];
  let images = 0,
    objects = 0,
    fields = 0,
    tracked = false;
  for (const m of xml.matchAll(tokens)) {
    const token = m[0],
      at = m.index;
    if (token[0] !== "<") {
      if (active) {
        const value = decode(token);
        nodes.push({
          from: at,
          to: at + token.length,
          start: base + text.length,
          end: base + text.length + value.length,
          value,
          open: active,
        });
        text += value;
      }
      continue;
    }
    if (/^<\?|^<!--/.test(token)) continue;
    const name = /^<\/?([^\s/>]+)/.exec(token)?.[1];
    if (!name) continue;
    const closing = token.startsWith("</"),
      self = /\/\s*>$/.test(token);
    const local = name.startsWith(prefix + ":")
      ? name.slice(prefix.length + 1)
      : defaultNs && !name.includes(":")
        ? name
        : "";
    // Reviewer identities on tracked changes and comments are part of the text model (same numbering/dictionary).
    if (!closing) {
      const author = /\s(?:\w+:)?author=(?:"([^"]*)"|'([^']*)')/.exec(token);
      const authorValue = author && (author[1] ?? author[2]);
      if (author && authorValue) {
        const from = at + author.index + author[0].indexOf(author[0].includes('"') ? '"' : "'") + 1;
        const value = decode(authorValue);
        const initials = /\s(?:\w+:)?initials=(?:"([^"]*)"|'([^']*)')/.exec(token);
        text += "\n"; // the author is its own line in the text model, never glued to run text
        nodes.push({
          from,
          to: from + authorValue.length,
          start: base + text.length,
          end: base + text.length + value.length,
          value,
          open: null,
          attr: "author",
          initials: initials
            ? {
                from: at + initials.index + initials[0].indexOf(initials[1] !== undefined ? '"' : "'") + 1,
                to: at + initials.index + initials[0].length - 1,
              }
            : null,
        });
        text += value + "\n";
      }
    }
    if (closing) {
      if (stack.pop() !== name) throw new Error("Malformed DOCX XML nesting.");
      if (local === "t" || local === "delText") active = null;
      if (local === "p" || local === "del") text += "\n";
      continue;
    }
    if (local === "fldChar") {
      if (/fldCharType=["']begin/.test(token)) {
        field++;
        fields++;
      }
      if (/fldCharType=["']end/.test(token)) field = Math.max(0, field - 1);
    }
    if (local === "fldSimple") fields++;
    if (local === "drawing" || local === "pict") images++;
    if (local === "object") objects++;
    if (local === "del" || local === "ins") {
      tracked = true;
      if (local === "del") text += "\n";
    }
    if (local === "tab" || local === "br" || local === "cr") text += "\t";
    if (
      (local === "t" || local === "delText") &&
      !field &&
      !stack.some((s) => s === prefix + ":fldSimple")
    )
      active = { from: at, to: at + token.length, token };
    if (!self) stack.push(name);
    else if (local === "t" || local === "delText") active = null;
  }
  if (stack.length) throw new Error("Unclosed DOCX XML element.");
  return { text, nodes, images, objects, fields, tracked };
}
export function loadDocx(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  let total = 0,
    count = 0;
  let parts;
  try {
    parts = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        count++;
        if (total > 100 * 1024 * 1024 || count > 10000)
          throw new Error(
            "DOCX expands beyond the 100 MB / 10,000 part safety limit.",
          );
        return true;
      },
    });
  } catch (e) {
    throw new Error("Cannot read DOCX: " + e.message);
  }
  if (!parts["word/document.xml"])
    throw new Error("DOCX is missing word/document.xml.");
  const names = Object.keys(parts)
    .filter((n) => allowed.test(n))
    .sort((a, b) =>
      a === "word/document.xml"
        ? -1
        : b === "word/document.xml"
          ? 1
          : a.localeCompare(b),
    );
  let text = "",
    models = [];
  for (const name of names) {
    const xml = strFromU8(parts[name]);
    const model = textModel(xml, text.length);
    models.push({ name, xml, ...model });
    text += model.text + "\n";
  }
  return { parts, models, text };
}
function replaceXML(model, matches) {
  const edits = [],
    opens = new Map();
  let mi = 0;
  for (const node of model.nodes) {
    while (mi < matches.length && matches[mi].end <= node.start) mi++;
    let value = node.value,
      local = [];
    for (let j = mi; j < matches.length && matches[j].start < node.end; j++) {
      const m = matches[j];
      const start = Math.max(0, m.start - node.start),
        end = Math.min(value.length, m.end - node.start);
      if (end > start)
        local.push({
          start,
          end,
          value: m.start >= node.start ? m.placeholder : "",
        });
    }
    if (!local.length) continue;
    for (const e of local.reverse())
      value = value.slice(0, e.start) + e.value + value.slice(e.end);
    if (node.attr) {
      edits.push({ from: node.from, to: node.to, value: encode(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;") });
      if (node.initials) edits.push({ from: node.initials.from, to: node.initials.to, value: "" });
      continue;
    }
    edits.push({ from: node.from, to: node.to, value: encode(value) });
    if (!/xml:space=/.test(node.open.token))
      opens.set(node.open.from, {
        from: node.open.from,
        to: node.open.to,
        value: node.open.token.replace(/>$/, ' xml:space="preserve">'),
      });
  }
  edits.push(...opens.values());
  let xml = model.xml;
  for (const e of edits.sort((a, b) => b.from - a.from))
    xml = xml.slice(0, e.from) + e.value + xml.slice(e.to);
  return xml;
}
function pack(parts) {
  return zipSync(
    Object.fromEntries(
      Object.entries(parts).map(([k, v]) => [
        k,
        [v, { mtime: new Date("2000-01-01T00:00:00Z") }],
      ]),
    ),
    { level: 6 },
  );
}
export function scrubDocx(bytes, policy = {}) {
  const doc = loadDocx(bytes),
    result = scrubText(doc.text, policy);
  for (const model of doc.models)
    doc.parts[model.name] = strToU8(replaceXML(model, result.matches));
  const skipped = [];
  if (doc.parts["word/people.xml"]) {
    // Presence info carries account identifiers (userId/providerId); drop it entirely.
    const xml = strFromU8(doc.parts["word/people.xml"]);
    const attrs = "(?:[^>\"']|\"[^\"]*\"|'[^']*')*";
    const out = xml
      .replace(new RegExp("<(\\w+:)?presenceInfo\\b" + attrs + "/\\s*>", "g"), "")
      .replace(new RegExp("<(\\w+:)?presenceInfo\\b" + attrs + ">[\\s\\S]*?</\\1presenceInfo\\s*>", "g"), "");
    if (/presenceInfo|userId|providerId/.test(out))
      throw new Error("Could not remove reviewer account identifiers from people.xml.");
    if (out !== xml) {
      doc.parts["word/people.xml"] = strToU8(out);
      skipped.push("people.xml: reviewer account identifiers removed");
    }
  }
  // Hyperlink targets (mailto:) and document properties carry identities outside the text model.
  const byValue = new Map(
    Object.entries(result.mapping.placeholders).map(([p, e]) => [e.value.toLowerCase(), p]),
  );
  let rels = 0;
  for (const name of Object.keys(doc.parts))
    if (/^word\/_rels\/.*\.rels$/.test(name)) {
      const xml = strFromU8(doc.parts[name]);
      const out = xml.replace(/Target="mailto:([^"?]+)([^"]*)"/g, (all, addr, rest) => {
        const p = byValue.get(decode(addr).toLowerCase());
        if (!p) return all;
        rels++;
        return 'Target="mailto:' + p + '"';
      });
      if (out !== xml) doc.parts[name] = strToU8(out);
    }
  if (rels) skipped.push(rels + " mailto: hyperlink targets replaced with placeholders (links no longer open a mail client)");
  const keptMail = [];
  for (const name of Object.keys(doc.parts))
    if (/^word\/_rels\/.*\.rels$/.test(name))
      for (const t of strFromU8(doc.parts[name]).matchAll(/Target="mailto:([^"?]+)/g)) keptMail.push(decode(t[1]));
  if (keptMail.length) skipped.push("mailto: hyperlink targets kept (address not in the text): " + [...new Set(keptMail)].join(", "));
  // Reviewer identities that matched nothing stay in Word's margin: say so, with the names, so they can be added to the dictionary.
  const keptAuthors = new Set();
  for (const model of doc.models)
    for (const node of model.nodes)
      if (node.attr === "author" && !result.matches.some((x) => x.start < node.end && x.end > node.start)) keptAuthors.add(node.value);
  if (keptAuthors.size) skipped.push("reviewer names kept in tracked changes/comments (add them to your dictionary): " + [...keptAuthors].join(", "));
  if (doc.parts["docProps/core.xml"]) {
    const xml = strFromU8(doc.parts["docProps/core.xml"]);
    const out = xml.replace(/(<(?:dc:creator|cp:lastModifiedBy)>)[^<]*(<\/)/g, "$1$2");
    if (out !== xml) {
      doc.parts["docProps/core.xml"] = strToU8(out);
      skipped.push("document properties: creator and last-modified-by cleared");
    }
  }
  for (const [key, label] of [
    ["images", "images"],
    ["objects", "embedded objects"],
    ["fields", "fields"],
  ]) {
    const n = doc.models.reduce((s, m) => s + m[key], 0);
    if (n) skipped.push(n + " " + label + " not inspected");
  }
  if (doc.models.some((m) => m.tracked))
    skipped.push("tracked changes present; deleted text also inspected");
  skipped.push(
    "Image text, embedded objects, custom XML, non-mailto hyperlink targets, and document properties other than creator/last-modified-by are not anonymised. Inspect these before sharing.",
  );
  result.report.skipped = skipped;
  return { ...result, output: pack(doc.parts), outputText: result.output };
}
export function restoreDocx(bytes, mapping) {
  const doc = loadDocx(bytes),
    matches = [];
  const unknown = new Set(),
    ord = {};
  const variants = new Map(
    (isExactOutput(mapping, doc.text) ? mapping.variants || [] : []).map(
      (v) => [v.placeholder + ":" + v.ordinal, v.value],
    ),
  );
  for (const m of doc.text.matchAll(
    /\[(?:PERSON|ORG|EMAIL|PHONE|IBAN|CARD|ID|SECRET|URL|ADDRESS|MONEY|TERM)_\d+\]/g,
  )) {
    const r = restoreDetailed(m[0], mapping);
    r.unknown.forEach((p) => unknown.add(p));
    if (r.output !== m[0])
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        placeholder: variants.get(m[0] + ":" + (ord[m[0]] || 0)) ?? r.output,
      });
    ord[m[0]] = (ord[m[0]] || 0) + 1;
  }
  for (const model of doc.models)
    doc.parts[model.name] = strToU8(replaceXML(model, matches));
  return { output: pack(doc.parts), unknown: [...unknown] };
}
