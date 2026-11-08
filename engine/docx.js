import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { scrubText } from "./scrub.js";
import { defaults } from "./detect.js";
import { restoreDetailed, isExactOutput, textHash } from "./restore.js";
const allowed =
  /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments|commentsExtended|people|glossary\/document)\.xml$/;
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
export function textModel(
  xml,
  base = 0,
  rootNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("DOCX XML entities/DTDs are unsupported.");
  const mainNs = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const prefixes = new Set();
  let rootSeen = false;
  const scopes = [new Map([["xml", "http://www.w3.org/XML/1998/namespace"]])];
  const instructions = [];
  let instruction = null;
  const tokens = /<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g;
  let text = "",
    nodes = [],
    active = null,
    field = [];
  const stack = [];
  let images = 0,
    objects = 0,
    fields = 0,
    tracked = false;
  for (const m of xml.matchAll(tokens)) {
    const token = m[0],
      at = m.index;
    if (token[0] !== "<") {
      if (instruction) {
        const value = decode(token);
        instruction.group.nodes.push({
          from: at,
          to: at + token.length,
          start: instruction.group.text.length,
          end: instruction.group.text.length + value.length,
          value,
          open: instruction.open,
        });
        instruction.group.text += value;
      }
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
    const scope = new Map(scopes[scopes.length - 1]);
    if (!closing) {
      const attrs = [
        ...token.matchAll(/\s([^\s=<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g),
      ];
      for (const binding of attrs.filter(
        (a) => a[1] === "xmlns" || a[1].startsWith("xmlns:"),
      )) {
        const prefix = binding[1] === "xmlns" ? "" : binding[1].slice(6),
          uri = decode(binding[2] ?? binding[3]);
        if (rootSeen && (uri === mainNs || prefixes.has(prefix)))
          throw new Error("Unsupported DOCX namespace redeclaration.");
        if (uri === "http://purl.oclc.org/ooxml/wordprocessingml/main")
          throw new Error("Unsupported DOCX Strict namespace.");
        scope.set(prefix, uri);
        if (uri === mainNs) prefixes.add(prefix);
      }
      const rootPrefix = name.includes(":") ? name.split(":")[0] : "";
      if (!rootSeen && scope.get(rootPrefix) !== rootNamespace)
        throw new Error("Unsupported DOCX namespace layout.");
      for (const attr of attrs) {
        const prefix = attr[1].includes(":") ? attr[1].split(":")[0] : "";
        if (prefix && prefix !== "xmlns" && !scope.get(prefix))
          throw new Error("Undeclared DOCX namespace prefix.");
      }
      rootSeen = true;
    }
    if (name.includes(":") && !scope.get(name.split(":")[0]))
      throw new Error("Undeclared DOCX namespace prefix.");
    const colon = name.indexOf(":"),
      prefix = colon < 0 ? "" : name.slice(0, colon);
    const local = prefixes.has(prefix) ? name.slice(colon + 1) : "";
    // Reviewer identities on tracked changes and comments are part of the text model (same numbering/dictionary).
    if (!closing) {
      const author = /\s(?:[^\s=:"\'/>]+:)?author=(?:"([^"]*)"|'([^']*)')/.exec(
        token,
      );
      const authorValue = author && (author[1] ?? author[2]);
      if (author && authorValue) {
        const from =
          at +
          author.index +
          author[0].indexOf(author[0].includes('"') ? '"' : "'") +
          1;
        const value = decode(authorValue);
        const initials =
          /\s(?:[^\s=:"\'/>]+:)?initials=(?:"([^"]*)"|'([^']*)')/.exec(token);
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
                from:
                  at +
                  initials.index +
                  initials[0].indexOf(initials[1] !== undefined ? '"' : "'") +
                  1,
                to: at + initials.index + initials[0].length - 1,
              }
            : null,
        });
        text += value + "\n";
      }
    }
    if (closing) {
      scopes.pop();
      if (local === "instrText") instruction = null;
      if (stack.pop() !== name) throw new Error("Malformed DOCX XML nesting.");
      if (local === "t" || local === "delText") active = null;
      if (local === "p" || local === "del") text += "\n";
      continue;
    }
    if (local === "fldChar") {
      if (/fldCharType=["']begin/.test(token)) {
        field.push({ result: false, group: { text: "", nodes: [] } });
        instructions.push(field[field.length - 1].group);
        fields++;
      }
      if (/fldCharType=["']separate/.test(token)) {
        if (!field.length) throw new Error("Malformed DOCX field separator.");
        field[field.length - 1].result = true;
      }
      if (/fldCharType=["']end/.test(token)) {
        if (!field.length) throw new Error("Malformed DOCX field end.");
        field.pop();
      }
    }
    if (local === "instrText") {
      const group = field[field.length - 1]?.group;
      if (!group) throw new Error("DOCX instruction outside a field.");
      instruction = { group, open: { from: at, to: at + token.length, token } };
    }
    if (local === "fldSimple") {
      fields++;
      const attr =
        /\s(?:[^\s=:"'/>]+:)?instr\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(token);
      if (attr) {
        const raw = attr[1] ?? attr[2],
          value = decode(raw);
        const from =
          at +
          attr.index +
          attr[0].indexOf(attr[1] !== undefined ? '"' : "'") +
          1;
        instructions.push({
          text: value,
          nodes: [
            {
              from,
              to: from + raw.length,
              start: 0,
              end: value.length,
              value,
              attr: "instruction",
            },
          ],
        });
      }
    }
    if (local === "drawing" || local === "pict") images++;
    if (local === "object") objects++;
    if (local === "del" || local === "ins") {
      tracked = true;
      if (local === "del") text += "\n";
    }
    if (local === "tab" || local === "br" || local === "cr") text += "\t";
    if ((local === "t" || local === "delText") && field.every((f) => f.result))
      active = { from: at, to: at + token.length, token };
    if (!self) {
      stack.push(name);
      scopes.push(scope);
    } else if (local === "instrText") instruction = null;
    else if (local === "t" || local === "delText") active = null;
  }
  if (!rootSeen) throw new Error("Unsupported DOCX namespace layout.");
  if (stack.length) throw new Error("Unclosed DOCX XML element.");
  if (field.length) throw new Error("Unclosed DOCX field.");
  return { text, nodes, images, objects, fields, tracked, instructions };
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
    const metadataNamespace = /(?:people|commentsExtended)\.xml$/.test(name)
      ? "http://schemas.microsoft.com/office/word/2012/wordml"
      : undefined;
    const model = textModel(xml, text.length, metadataNamespace);
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
      edits.push({
        from: node.from,
        to: node.to,
        value: encode(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;"),
      });
      if (node.initials)
        edits.push({
          from: node.initials.from,
          to: node.initials.to,
          value: "",
        });
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
// Resolve OPC relationship ownership instead of assuming a flat word/_rels directory.
function relationshipParts(doc) {
  const inspected = new Set(doc.models.map((m) => m.name));
  const handled = [],
    unhandled = [];
  for (const name of Object.keys(doc.parts).sort()) {
    if (!name.startsWith("word/") || !name.endsWith(".rels")) continue;
    const match = /^(word\/(?:[^/]+\/)*)_rels\/([^/]+)\.rels$/.exec(name);
    const owner = match && match[1] + match[2];
    (owner && inspected.has(owner) ? handled : unhandled).push(name);
  }
  return { handled, unhandled };
}
function mapRelationshipTargets(xml, transform) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("DOCX relationship entities/DTDs are unsupported.");
  let index = 0, mailIndex = 0;
  return xml.replace(
    /\bTarget\s*=\s*("[^"]*"|'[^']*')/g,
    (attribute, quoted) => {
      const raw = quoted.slice(1, -1);
      const isMail = /^mailto:/i.test(decode(raw).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ""));
      const replacement = transform(raw, index++, isMail ? mailIndex++ : -1);
      return (
        attribute.slice(0, attribute.indexOf(quoted)) +
        quoted[0] +
        replacement +
        quoted[0]
      );
    },
  );
}
export function scrubDocx(bytes, policy = {}) {
  const doc = loadDocx(bytes),
    result = scrubText(doc.text, policy);
  for (const model of doc.models)
    doc.parts[model.name] = strToU8(replaceXML(model, result.matches));
  // Reparse after visible edits so instruction offsets still point into current XML.
  const instructionDoc = loadDocx(pack(doc.parts));
  const detectors = Object.fromEntries(
    Object.keys(defaults).map((k) => [k, false]),
  );
  const instructionValues = [];
  for (const model of instructionDoc.models)
    for (const group of model.instructions) {
      if (!/^\s*(?:HYPERLINK|MAILTO)\b/i.test(group.text)) continue;
      const urls = [...group.text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map(
        (m) => ({
          start: m.index,
          end: m.index + m[0].length,
          category: "URL",
        }),
      );
      const detected = scrubText(group.text, {
        mapping: result.mapping,
        detectors: { ...detectors, email: true },
        manual: urls,
      });
      Object.assign(result.mapping.placeholders, detected.mapping.placeholders);
      instructionValues.push(
        ...detected.matches.map((m) => ({
          value: group.text.slice(m.start, m.end),
          category: m.category,
        })),
      );
    }
  for (const model of instructionDoc.models) {
    const nodes = [],
      matches = [];
    let offset = 0;
    for (const [index, group] of model.instructions.entries()) {
      const manual = [];
      const values = [
        ...instructionValues,
        ...Object.values(result.mapping.placeholders),
        ...(result.mapping.variants || []).map((v) => ({
          value: v.value,
          category: result.mapping.placeholders[v.placeholder].category,
        })),
      ];
      for (const entry of values) {
        if (!entry.value) continue;
        let at = group.text.indexOf(entry.value);
        while (at >= 0) {
          manual.push({
            start: at,
            end: at + entry.value.length,
            category: entry.category,
          });
          at = group.text.indexOf(entry.value, at + entry.value.length);
        }
      }
      const cleaned = scrubText(group.text, {
        mapping: result.mapping,
        detectors,
        manual,
      });
      Object.assign(result.mapping.placeholders, cleaned.mapping.placeholders);
      if (cleaned.mapping.variants?.length) {
        (result.mapping.docxInstructions ||= []).push({
          part: model.name,
          index,
          outputHash: textHash(cleaned.output),
          variants: cleaned.mapping.variants,
        });
      }
      nodes.push(
        ...group.nodes.map((n) => ({
          ...n,
          start: n.start + offset,
          end: n.end + offset,
        })),
      );
      matches.push(
        ...cleaned.matches.map((m) => ({
          ...m,
          start: m.start + offset,
          end: m.end + offset,
        })),
      );
      offset += group.text.length + 1;
    }
    doc.parts[model.name] = strToU8(replaceXML({ ...model, nodes }, matches));
  }
  const skipped = [];
  if (doc.parts["word/people.xml"]) {
    // Presence info carries account identifiers (userId/providerId); drop it entirely.
    const xml = strFromU8(doc.parts["word/people.xml"]);
    const attrs = "(?:[^>\"']|\"[^\"]*\"|'[^']*')*";
    const out = xml
      .replace(
        new RegExp("<(\\w+:)?presenceInfo\\b" + attrs + "/\\s*>", "g"),
        "",
      )
      .replace(
        new RegExp(
          "<(\\w+:)?presenceInfo\\b" +
            attrs +
            ">[\\s\\S]*?</\\1presenceInfo\\s*>",
          "g",
        ),
        "",
      );
    if (/presenceInfo|userId|providerId/.test(out))
      throw new Error(
        "Could not remove reviewer account identifiers from people.xml.",
      );
    if (out !== xml) {
      doc.parts["word/people.xml"] = strToU8(out);
      skipped.push("people.xml: reviewer account identifiers removed");
    }
  }
  // Handle mail targets of every inspected part, including nested glossary relationships.
  const relationships = relationshipParts(doc);
  let rels = 0,
    keptMail = 0, keptTargets = 0;
  for (const name of [
    ...relationships.handled,
    ...relationships.unhandled,
  ].sort()) {
    const xml = strFromU8(doc.parts[name]);
    const out = mapRelationshipTargets(xml, (raw, index, mailIndex) => {
      const decoded = decode(raw);
      const target = decoded.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
      if (mailIndex < 0) {
        const cleaned = scrubText(decoded, {
          mapping: result.mapping,
          detectors: { ...detectors, email: true },
          dictionary: policy.dictionary,
        });
        Object.assign(result.mapping.placeholders, cleaned.mapping.placeholders);
        if (cleaned.output.includes("@")) keptTargets++;
        if (!cleaned.matches.length) return raw;
        const value = encode(cleaned.output).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
        (result.mapping.docxRelationships ||= []).push({part: name, targetIndex: index, outputHash: textHash(value), value: raw});
        return value;
      }
      let payload;
      try {
        payload = decodeURIComponent(target.slice(7));
      } catch {
        throw new Error("Malformed DOCX mailto target encoding.");
      }
      // Queries may carry arbitrary private text. Drop them in the shared document;
      // the explicit mapping retains the original target for exact restoration.
      const question = payload.indexOf("?");
      const address = payload.slice(
        0,
        question < 0 ? payload.length : question,
      );
      const cleaned = scrubText(address, {
        mapping: result.mapping,
        detectors: { ...detectors, email: true },
      });
      Object.assign(result.mapping.placeholders, cleaned.mapping.placeholders);
      if (!cleaned.matches.length && !/^\[EMAIL_\d+\]$/.test(address))
        keptMail++;
      if (!cleaned.matches.length && question < 0) return raw;
      const value = encode(target.slice(0, 7) + cleaned.output)
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
      (result.mapping.docxRelationships ||= []).push({
        part: name,
        targetIndex: index,
        outputHash: textHash(value),
        value: raw,
      });
      rels++;
      return value;
    });
    if (out !== xml) doc.parts[name] = strToU8(out);
  }
  if (rels)
    skipped.push(
      rels +
        " mailto: hyperlink targets replaced with placeholders (links no longer open a mail client)",
    );
  if (keptMail)
    skipped.push(
      keptMail +
        " mailto: hyperlink targets kept (unrecognised addresses; inspect before sharing)",
    );
  if (keptTargets) skipped.push(keptTargets + " relationship targets containing @ kept (inspect before sharing)");
  if (relationships.unhandled.length)
    skipped.push(
      relationships.unhandled.length +
        " relationship parts belonging to uninspected content not inspected",
    );
  // Reviewer identities that matched nothing stay in Word's margin: say so, with the names, so they can be added to the dictionary.
  const keptAuthors = new Set();
  for (const model of doc.models)
    for (const node of model.nodes)
      if (
        node.attr === "author" &&
        !result.matches.some((x) => x.start < node.end && x.end > node.start)
      )
        keptAuthors.add(node.value);
  if (keptAuthors.size)
    skipped.push(
      "reviewer names kept in tracked changes/comments (add them to your dictionary): " +
        [...keptAuthors].join(", "),
    );
  if (doc.parts["docProps/core.xml"]) {
    const xml = strFromU8(doc.parts["docProps/core.xml"]);
    const out = xml.replace(
      /(<(?:dc:creator|cp:lastModifiedBy)>)[^<]*(<\/)/g,
      "$1$2",
    );
    if (out !== xml) {
      doc.parts["docProps/core.xml"] = strToU8(out);
      skipped.push("document properties: creator and last-modified-by cleared");
    }
  }
  for (const [key, label] of [
    ["images", "images"],
    ["objects", "embedded objects"],
    [
      "fields",
      "field instructions (including HYPERLINK/MAILTO codes; visible results inspected)",
    ],
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
  const instructionDoc = loadDocx(pack(doc.parts));
  for (const model of instructionDoc.models) {
    const nodes = [],
      replacements = [];
    let offset = 0;
    for (const [index, group] of model.instructions.entries()) {
      const exact = mapping.docxInstructions?.find(
        (v) =>
          v.part === model.name &&
          v.index === index &&
          v.outputHash === textHash(group.text),
      );
      const ordinals = {};
      for (const m of group.text.matchAll(
        /\[(?:PERSON|ORG|EMAIL|PHONE|IBAN|CARD|ID|SECRET|URL|ADDRESS|MONEY|TERM)_\d+\]/g,
      )) {
        const r = restoreDetailed(m[0], {
          ...mapping,
          outputHash: undefined,
          variants: [],
        });
        r.unknown.forEach((p) => unknown.add(p));
        const ordinal = ordinals[m[0]] || 0;
        ordinals[m[0]] = ordinal + 1;
        const value =
          exact?.variants.find(
            (v) => v.placeholder === m[0] && v.ordinal === ordinal,
          )?.value ?? r.output;
        if (value !== m[0])
          replacements.push({
            start: offset + m.index,
            end: offset + m.index + m[0].length,
            placeholder: value,
          });
      }
      nodes.push(
        ...group.nodes.map((n) => ({
          ...n,
          start: n.start + offset,
          end: n.end + offset,
        })),
      );
      offset += group.text.length + 1;
    }
    doc.parts[model.name] = strToU8(
      replaceXML({ ...model, nodes }, replacements),
    );
  }
  for (const name of Object.values(relationshipParts(doc)).flat().sort()) {
    const xml = strFromU8(doc.parts[name]);
    doc.parts[name] = strToU8(
      mapRelationshipTargets(xml, (raw, index, mailIndex) => {
        const saved = mapping.docxRelationships?.find(
          (v) =>
            v.part === name &&
            (v.targetIndex !== undefined ? v.targetIndex === index : v.index === mailIndex) &&
            v.outputHash === textHash(raw),
        );
        if (saved)
          return encode(decode(saved.value))
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
        const restored = restoreDetailed(decode(raw), mapping);
        restored.unknown.forEach((p) => unknown.add(p));
        return restored.output === decode(raw)
          ? raw
          : encode(restored.output)
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&apos;");
      }),
    );
  }
  return { output: pack(doc.parts), unknown: [...unknown] };
}
