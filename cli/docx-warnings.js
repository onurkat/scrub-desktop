// Convert engine diagnostics to content-free, translatable notices.
// Never pass through raw messages: some upstream diagnostics contain originals.
export function docxWarnings(skipped = []) {
  const notices = [];
  for (const message of skipped) {
    const n = Number(/^\d+/.exec(message)?.[0] || 0);
    if (/^\d+ images not inspected$/.test(message))
      notices.push(["docxImages", n]);
    else if (/^\d+ embedded objects not inspected$/.test(message))
      notices.push(["docxObjects", n]);
    else if (/^\d+ (fields|field instructions).*not inspected$/.test(message))
      notices.push(["docxFields", n]);
    else if (message.startsWith("tracked changes present"))
      notices.push(["docxTracked"]);
    else if (/^\d+ mailto:/.test(message))
      notices.push(["docxMailReplaced", n]);
    else if (message.startsWith("mailto: hyperlink targets kept")) {
      const values = message
        .slice(message.indexOf("): ") + 3)
        .split(", ")
        .filter((v) => v && !/^\[EMAIL_\d+\]$/.test(v));
      if (values.length) notices.push(["docxMailKept", values.length]);
    } else if (message.startsWith("reviewer names kept")) {
      notices.push([
        "docxReviewers",
        message
          .slice(message.indexOf("): ") + 3)
          .split(", ")
          .filter(Boolean).length,
      ]);
    } else if (
      message.startsWith("people.xml:") ||
      message.startsWith("document properties:")
    )
      notices.push(["docxCleaned"]);
    else notices.push(["docxGeneral"]);
  }
  return notices.filter(
    (row, i) =>
      notices.findIndex(
        (other) => JSON.stringify(other) === JSON.stringify(row),
      ) === i,
  );
}
