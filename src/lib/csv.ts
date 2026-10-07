/** Text for spreadsheet consumption: escape all columns and neutralize formula prefixes. */
export function csvTextCell(value: string): string {
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
