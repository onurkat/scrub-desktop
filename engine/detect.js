export const categories = [
  "PERSON",
  "ORG",
  "EMAIL",
  "PHONE",
  "IBAN",
  "CARD",
  "ID",
  "SECRET",
  "URL",
  "ADDRESS",
  "MONEY",
  "TERM",
];
export const defaults = Object.freeze({
  email: true,
  phone: true,
  iban: true,
  card: true,
  nationalId: true,
  secret: true,
  url: true,
  address: true,
  money: false,
  nameHeuristic: false,
});
export const ibanLengths = {
    AL: 28,
    AD: 24,
    AT: 20,
    AZ: 28,
    BH: 22,
    BE: 16,
    BA: 20,
    BR: 29,
    BG: 22,
    CR: 22,
    HR: 21,
    CY: 28,
    CZ: 24,
    DK: 18,
    DO: 28,
    EE: 20,
    FO: 18,
    FI: 18,
    FR: 27,
    GE: 22,
    DE: 22,
    GI: 23,
    GR: 27,
    GL: 18,
    GT: 28,
    HU: 28,
    IS: 26,
    IE: 22,
    IL: 23,
    IT: 27,
    JO: 30,
    KZ: 20,
    XK: 20,
    KW: 30,
    LV: 21,
    LB: 28,
    LI: 21,
    LT: 20,
    LU: 20,
    MT: 31,
    MR: 27,
    MU: 30,
    MD: 24,
    MC: 27,
    ME: 22,
    NL: 18,
    NO: 15,
    PK: 24,
    PS: 29,
    PL: 28,
    PT: 25,
    QA: 29,
    RO: 24,
    SM: 27,
    SA: 24,
    RS: 22,
    SK: 24,
    SI: 19,
    ES: 24,
    SE: 24,
    CH: 21,
    TN: 24,
    TR: 26,
    AE: 23,
    GB: 22,
    VA: 22,
    UA: 29,
    SC: 31,
    LC: 32,
    ST: 25,
    TL: 23,
    IQ: 23,
    SV: 28,
    BY: 28,
};
export function ibanValid(value) {
  const s = value.replace(/\s/g, "").toUpperCase();
  if (
    !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s) ||
    ibanLengths[s.slice(0, 2)] !== s.length
  )
    return false;
  let n = 0;
  for (const c of s.slice(4) + s.slice(0, 4))
    for (const d of /\d/.test(c) ? c : String(c.charCodeAt(0) - 55))
      n = (n * 10 + Number(d)) % 97;
  return n === 1;
}
export function luhnValid(s) {
  s = s.replace(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(s)) return false;
  let sum = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = +s[i];
    if ((s.length - 1 - i) % 2) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0;
}
// Printed card numbers are either unbroken or grouped 4-4-4-4(-3), 4-6-5 (Amex) or 4-6-4; phone-like groupings are not cards.
export function cardGroupsOk(s) {
  const groups = s.split(/[ -]/).map((g) => g.length);
  if (groups.length === 1) return true;
  const allFour = groups.slice(0, -1).every((g) => g === 4) && groups.at(-1) >= 1 && groups.at(-1) <= 4;
  return allFour || [[4, 6, 5], [4, 6, 4]].some((p) => p.join() === groups.join());
}
export function cardValid(s) {
  s = s.replace(/[ -]/g, "");
  const p = +s.slice(0, 4);
  return /^(4|5[1-5]|3[47]|6011|65|9792)/.test(s) || (p >= 2221 && p <= 2720)
    ? luhnValid(s)
    : false;
}
export function tcknValid(s) {
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = [...s].map(Number);
  return (
    ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - d[1] - d[3] - d[5] - d[7]) %
      10 ===
      d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10]
  );
}
export function steuerValid(s) {
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const a = [...s.slice(0, 10)].map(Number),
    freq = Array(10).fill(0);
  a.forEach((n) => freq[n]++);
  if (!(
    (freq.filter((n) => n === 2).length === 1 &&
      freq.filter((n) => n === 0).length === 1) ||
    (freq.filter((n) => n === 3).length === 1 &&
      freq.filter((n) => n === 0).length === 2)
  ))
    return false;
  let p = 10;
  for (const n of a) {
    let sum = (n + p) % 10;
    if (!sum) sum = 10;
    p = (sum * 2) % 11;
  }
  return (11 - p) % 10 === +s[10];
}
const word = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
export function detect(text, options = {}) {
  const policy = { ...defaults, ...options },
    matches = [],
    review = [];
  const add = (start, end, category, rank) => {
    if (end > start)
      matches.push({
        start,
        end,
        category,
        rank,
        value: text.slice(start, end),
      });
  };
  const scan = (re, category, rank, valid = () => true) => {
    for (const m of text.matchAll(re))
      if (valid(m[0], m)) add(m.index, m.index + m[0].length, category, rank);
  };
  // Tokenize once (no quadratic backtracking on aaaa…@), then take the longest valid email prefix of the
  // token so trailing punctuation such as "!", "?", ")" or "'s" never hides an address.
  if (policy.email)
    for (const m of text.matchAll(
      /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]+(?:\.[A-Za-z0-9@-]+)*/g,
    )) {
      const token = m[0].slice(0, 320);
      const e =
        /[A-Za-z0-9!#$%&'*+/=?^_`{|}~-](?:[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{0,62}[A-Za-z0-9!#$%&*+/=?^_`{|}~-])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,63}/.exec(
          token,
        );
      if (e) add(m.index + e.index, m.index + e.index + e[0].length, "EMAIL", 0);
    }
  if (policy.iban) {
    const re = /(?<![A-Z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}/gi;
    let m;
    while ((m = re.exec(text))) {
      const L = ibanLengths[m[0].slice(0, 2).toUpperCase()];
      if (!L) continue;
      let count = 0,
        i = m.index;
      for (; i < text.length && count < L; i++) {
        if (/[A-Z0-9]/i.test(text[i])) count++;
        else if (text[i] !== " ") break;
      }
      if (count < L || word(text[i])) continue;
      const v = text.slice(m.index, i);
      if (ibanValid(v)) {
        add(m.index, i, "IBAN", 2);
        re.lastIndex = i;
      } else re.lastIndex = m.index + 4;
    }
  }

  if (policy.card)
    for (const m of text.matchAll(/(?<![\d\p{L}])\d(?:[ -]?\d)*(?![\d\p{L}])/gu)) {
      // Single-digit groups never belong to a printed card: they split the run into independent segments.
      const segments = [];
      for (const seg of m[0].matchAll(/\d{2,}(?:[ -]?\d{2,})*|\d{13,}/g)) segments.push([m.index + seg.index, seg[0]]);
      for (const [offset, run] of segments) {
      const digits = [];
      for (let i = 0; i < run.length; i++) if (/\d/.test(run[i])) digits.push(i);
      if (digits.length < 13) continue;
      let from = 0;
      while (from + 13 <= digits.length) {
        let found = null;
        for (let len = Math.min(19, digits.length - from); len >= 13 && !found; len--) {
          const a = digits[from],
            b = digits[from + len - 1] + 1;
          const next = run[b],
            prev = run[a - 1];
          if ((next !== undefined && /\d/.test(next)) || (prev !== undefined && /\d/.test(prev))) continue;
          const candidate = run.slice(a, b);
          if (!cardGroupsOk(candidate)) continue;
          if (cardValid(candidate)) found = { a, b, len };
        }
        if (found) {
          add(offset + found.a, offset + found.b, "CARD", 3);
          from += found.len;
        } else from++;
      }
      }
    }
  if (policy.nationalId) {
    scan(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, "ID", 4);
    scan(
      /\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/gi,
      "ID",
      4,
      (s) => !/^(BG|GB|KN|NK|NT|TN|ZZ)/i.test(s),
    );
    scan(/\b\d{11}\b/g, "ID", 4, (s) => tcknValid(s) || steuerValid(s));
    for (const m of text.matchAll(
      /\b(?:passport|id)\s*(?:no\.?|number)\s*[:#=]?\s*((?=[A-Z0-9]{0,11}\d)[A-Z0-9]{6,12})\b/gi,
    )) {
      const at = m.index + m[0].lastIndexOf(m[1]);
      add(at, at + m[1].length, "ID", 4);
    }
  }
  if (policy.secret) {
    scan(
      /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,256}|sk-[A-Za-z0-9_-]{10,256}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{20,256}|xoxb-[A-Za-z0-9-]{10,256}|AIza[A-Za-z0-9_-]{30,256})\b/g,
      "SECRET",
      5,
    );
    scan(
      /\beyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,8192}\.[A-Za-z0-9_-]{8,2048}\b/g,
      "SECRET",
      5,
    );
    // Linear block search instead of an unbounded lazy regex with repeated begin markers.
    let at = 0;
    while ((at = text.indexOf("-----BEGIN ", at)) !== -1) {
      const head = /^-----BEGIN ([A-Z ]{0,40}PRIVATE KEY)-----/.exec(
        text.slice(at, at + 80),
      );
      if (!head) {
        at += 11;
        continue;
      }
      const end = text.indexOf(
        "-----END " + head[1] + "-----",
        at + head[0].length,
      );
      if (end < 0) {
        review.push({
          text: head[0],
          offset: at,
          reason: "Unclosed private key block — inspect manually",
        });
        at += head[0].length;
      } else {
        const to = end + ("-----END " + head[1] + "-----").length;
        add(at, to, "SECRET", 5);
        at = to;
      }
    }
    for (const m of text.matchAll(
      /(?<![A-Za-z0-9])([A-Za-z0-9_.-]{0,64}?(?:token|key|secret|password|passphrase|passwd|pwd|credential)s?)["']?\s*[:=]\s*["']?([^\s"'<>;,&]{8,4096})/gi,
    )) {
      // Ordinary words that merely end in "key" are not credential labels.
      if (/^(?:tur|mon|hoc|don|joc|hot|whis|lac|smo|coc|han|jun|malar|par)key$/i.test(m[1])) continue;
      // A public key is not a credential, but only when the value really is a public key.
      if (
        /^(?:ssh-(?:rsa|ed25519|dss)|ecdsa-sha2-|sk-ssh-|-----BEGIN PUBLIC KEY)/.test(m[2]) &&
        (/(?:^|[_.-])public[_.-]?keys?$/i.test(m[1]) ||
          (/^keys?$/i.test(m[1]) && /public\s+$/i.test(text.slice(Math.max(0, m.index - 8), m.index))))
      )
        continue;
      // Checks run on the full capture; at most one trailing sentence punctuation mark is left out, and only at
      // a word end (whitespace or end of text), so stripping can never turn a secret into a non-match.
      const full = m[2],
        after = text[m.index + m[0].length];
      const s =
        /[.,;:)\]}]$/.test(full) && (after === undefined || /\s/.test(after))
          ? full.slice(0, -1)
          : full;
      // A credential has digits, or is long and mixed-case, or is a long lowercase passphrase with separators;
      // plain words and identifiers ("Understanding", "lastName", "orders.customer_id") are not secrets.
      if (
        full.length >= 8 &&
        new Set(full).size >= 5 &&
        (/\d/.test(full) ||
          (full.length >= 20 && /[a-z]/.test(full) && /[A-Z]/.test(full)) ||
          (full.length >= 16 && /[^A-Za-z0-9_.]/.test(s)))
      ) {
        const start = m.index + m[0].lastIndexOf(m[2]);
        add(start, start + s.length, "SECRET", 5);
      }
    }
  }
  if (policy.url)
    for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const re =
        /[?&]([A-Za-z0-9_-]*(?:token|key|sig|signature|auth|session|password|secret|code))=([^&#\s)]*)/gi;
      for (const q of m[0].matchAll(re)) {
        if (q[2]) {
          const start = m.index + q.index + q[0].length - q[2].length;
          add(start, start + q[2].length, "SECRET", 6);
        }
      }
    }
  if (policy.address) {
    for (const m of text.matchAll(/^\s*Address:[ \t]*(.+)$/gim)) {
      const value = m[1].replace(/\r$/, "");
      const start = m.index + m[0].indexOf(m[1]);
      add(start, start + value.length, "ADDRESS", 7);
    }
    scan(
      /\b\d{1,6}[ \t]+(?:\p{Lu}[\p{L}.'’-]*[ \t]+){1,5}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Cad\.|Sok\.|Str\.|Straße|Platz)(?!\p{L})(?:,[ \t]*\p{Lu}[\p{L}.'’-]{0,30}(?:[ ]\p{L}[\p{L}.'’-]{0,30}(?![\p{L}\d.'’-]*@|\d)){0,4}(?: ?(?:[A-Z]{1,2}\d{1,2}[A-Z]? ?\d[A-Z]{2}|\d{2,5}(?:[ -]?[A-Z0-9]{2,4})?))?)?/gu,
      "ADDRESS",
      7,
    );
  }
  if (policy.money)
    scan(
      /(?:[$€£₺][ \t]*\d{1,15}(?:[.,]\d{1,3})*|\b(?:USD|EUR|GBP|TRY)[ \t]+\d{1,15}(?:[.,]\d{1,3})*)/g,
      "MONEY",
      8,
    );
  const protectedSpans = matches
    .filter((x) => ["IBAN", "CARD", "ID"].includes(x.category))
    .sort((a, b) => a.start - b.start);
  let maxProtected = 0;
  const protectedEnds = protectedSpans.map(
    (m) => (maxProtected = Math.max(maxProtected, m.end)),
  );
  const overlapsProtected = (start, end) => {
    let lo = 0,
      hi = protectedSpans.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (protectedSpans[mid].start < end) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && protectedEnds[lo - 1] > start;
  };
  if (policy.phone) {
    const re = /(?<![\p{L}\d(])[+(]?\d[\d ().\/-]{5,40}\d(?![\d\p{L}])/gu;
    let m,
      acceptedEnd = -1;
    while ((m = re.exec(text))) {
      // Never start inside a decimal or date ("0.0000123", "05/11"), except right after an accepted phone
      // ("0532 123 45 67-0533 123 45 67").
      if (/\d[.,\/-]$/.test(text.slice(Math.max(0, m.index - 2), m.index)) && m.index - 1 !== acceptedEnd) {
        re.lastIndex = m.index + 1;
        continue;
      }
      // " - ", " / " and "," are hard separators between two numbers: only the first one is this candidate.
      const segments = m[0].split(/\s[-\/]\s|,|\.\s/);
      let value = segments[0];
      // "+49 30 / 1234567" is one number; "0532 123 45 67 / 0532 987 65 43" is two: a hard separator only
      // ends the candidate once it already holds at least 7 digits.
      for (let k = 1; k < segments.length && value.replace(/\D/g, "").length < 7; k++)
        value = m[0].slice(0, m[0].indexOf(segments[k], value.length) + segments[k].length);
      // Parenthesised groups are area codes only: "(555)", "+1 (555)", "+49 (0)", UK "(01234)".
      if (value.includes("(") || value.includes(")")) {
        if (!/^\+?\d{0,3}[ -]?\((?:\d{1,4}|0\d{1,4})\)/.test(value)) {
          re.lastIndex = m.index + 1;
          continue;
        }
        const close = value.indexOf(")");
        const extra = value.slice(close + 1).search(/[()]/);
        if (extra >= 0) value = value.slice(0, close + 1 + extra);
      }
      value = value.replace(/[ ./-]+$/, "");
      // Too many digits: drop trailing separator groups (a date or a second number after the phone).
      let groups = value.split(/(?<=\d)[ \/-](?=[\d(])/);
      const digitsOf = (g) => g.join("").replace(/\D/g, "").length;
      if (digitsOf(groups) > 15) {
        // Prefer cutting where a new number starts ("0…", "+…", "(…"), e.g. "0532 123 45 67-0533 123 45 67".
        let cut = -1;
        for (let k = groups.length - 1; k > 0 && cut < 0; k--)
          if (/^[0+(]/.test(groups[k]) && digitsOf(groups.slice(0, k)) >= 7 && digitsOf(groups.slice(0, k)) <= 15) cut = k;
        if (cut > 0) groups = groups.slice(0, cut);
      }
      while (digitsOf(groups) > 15 && groups.length > 1) groups.pop();
      value = m[0].slice(0, groups.join(" ").length);
      const n = value.replace(/\D/g, "");
      const before = text.slice(Math.max(0, m.index - 18), m.index);
      const digitGroups = value.replace(/^\+/, "").split(/[^\d]+/).filter(Boolean);
      if (
        n.length < 7 ||
        n.length > 15 ||
        !(
          /^[+0(]/.test(value) ||
          /\b(?:tel|phone|mobile|gsm|fax)\s*[:.]?\s*$/i.test(before)
        )
      )
        {
          re.lastIndex = m.index + 1;
          continue;
        }
      const bare = value.replace(/^\(|\)$/g, "");
      if (
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare) ||
        /^\d{1,4}[.\/-]\d{1,2}[.\/-]\d{2,4}(?![\d])/.test(bare) || // starts with a date (any trailing time)
        /^\d{1,2}\s?[-\/]\s?(?:19|20)\d{2}(?!\d)/.test(bare) || // time or range fragment followed by a year
        /^\d+[.,]\d+$/.test(bare) ||
        /^\d+[.,]\d+(?:\s+\d+[.,]\d+)+$/.test(bare) || // decimal series like "0.1 0.2 0.3"
        (digitGroups.length >= 3 && digitGroups.every((g) => g.length === 4) && /-/.test(bare)) // serial 0000-1111-2222
      )
        {
          re.lastIndex = m.index + 1;
          continue;
        }
      if (!overlapsProtected(m.index, m.index + value.length)) {
        add(m.index, m.index + value.length, "PHONE", 1);
        acceptedEnd = m.index + value.length;
      }
      re.lastIndex = m.index + value.length;
    }
  }
  if (policy.nameHeuristic) {
    const stop = new Set(
      "January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday United States United Kingdom Germany Turkey France Terms Conditions Privacy Policy New York Total Amount".split(
        " ",
      ),
    );
    for (const m of text.matchAll(
      /\b\p{Lu}\p{Ll}{1,30}(?: +\p{Lu}\p{Ll}{1,30}){1,2}/gu,
    )) {
      const prior = text
        .slice(Math.max(0, m.index - 128), m.index)
        .replace(/[ \t]+$/, "")
        .slice(-1);
      if (
        prior &&
        !/[.!?\n]/.test(prior) &&
        !m[0].split(" ").some((s) => stop.has(s))
      )
        review.push({
          text: m[0],
          offset: m.index,
          reason: "Possible name; not automatically replaced",
        });
    }
  }
  return { matches, review };
}
