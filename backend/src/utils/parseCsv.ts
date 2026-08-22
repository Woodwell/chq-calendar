/**
 * Minimal RFC 4180 CSV reader.
 *
 * Written rather than depended on: the one file this parses has ~1,100 cells
 * carrying commas, quotes or newlines inside quoted fields, so a `split(',')`
 * is not an option — but that is the whole of the requirement, and a
 * dependency for it would have to be justified to every future reader.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // Strip a UTF-8 BOM: Sheets exports carry one and it would otherwise become
  // part of the first header name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') { field += ch; continue; }
      // A doubled quote inside a quoted field is a literal quote.
      if (src[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  // A file not ending in a newline still has a last row.
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Rows keyed by a header line. `headerRow` is an index because this file
 * carries a spanning title row above the real header.
 */
export function parseCsvRecords(text: string, headerRow = 0): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[headerRow] ?? [];
  return rows
    .slice(headerRow + 1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}
