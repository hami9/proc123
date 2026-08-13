import { UTF8_BOM } from '@proc123/exporters';

export { makeProduct } from '../../core/test/factory.js';

/**
 * A small RFC 4180 reader, so tests assert on parsed rows rather than on raw
 * text. It also round-trips the writer: anything the writer quotes wrongly
 * shows up here as a misaligned row.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r' && input[index + 1] === '\n') {
      endRow();
      index += 2;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

export interface CsvTable {
  header: string[];
  rows: string[][];
  records: Record<string, string>[];
}

export function readCsv(text: string): CsvTable {
  const [header = [], ...rows] = parseCsv(text);
  const records = rows.map((row) => {
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[name] = row[index] ?? '';
    });
    return record;
  });
  return { header, rows, records };
}
