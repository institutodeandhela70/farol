// Parser de CSV simples — roda no browser, sem lib externa. Evitamos o pacote
// `xlsx` (SheetJS) de propósito: a versão publicada no npm tem duas
// vulnerabilidades altas sem correção disponível (prototype pollution + ReDoS),
// e não vale o risco pra um caso de uso que um export em CSV já resolve.
// Suporta campos entre aspas (com vírgula/quebra de linha dentro) e "" como
// aspas escapada, igual ao dialeto que Excel/Sheets geram ao exportar CSV.

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(raw: string): ParsedCsv {
  const text = raw.replace(/^﻿/, ""); // remove BOM (comum em CSV exportado do Excel)
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === "," || char === ";") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  const [headerRow, ...dataRows] = nonEmptyRows;

  return {
    headers: (headerRow ?? []).map((h) => h.trim()),
    rows: dataRows,
  };
}

const FIELD_MATCHERS: Record<string, RegExp> = {
  full_name: /^nome/i,
  email: /e-?mail/i,
  phone: /telefone|celular|fone|whats/i,
  cpf: /cpf/i,
};

export interface ParsedParticipantRow {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  cpf: string | null;
}

// Mapeia colunas pelo nome do cabeçalho (case-insensitive, aceita variações
// como "E-mail"/"Email", "Telefone"/"Celular") — sem tela de mapeamento manual,
// espera que a planilha já tenha essas colunas com nome reconhecível.
export function mapParticipantRows(parsed: ParsedCsv): ParsedParticipantRow[] {
  const columnIndexByField: Partial<Record<keyof typeof FIELD_MATCHERS, number>> = {};
  Object.entries(FIELD_MATCHERS).forEach(([field, matcher]) => {
    const index = parsed.headers.findIndex((h) => matcher.test(h));
    if (index >= 0) columnIndexByField[field as keyof typeof FIELD_MATCHERS] = index;
  });

  return parsed.rows.map((row) => ({
    full_name: columnIndexByField.full_name != null ? row[columnIndexByField.full_name]?.trim() || null : null,
    email: columnIndexByField.email != null ? row[columnIndexByField.email]?.trim() || null : null,
    phone: columnIndexByField.phone != null ? row[columnIndexByField.phone]?.trim() || null : null,
    cpf: columnIndexByField.cpf != null ? row[columnIndexByField.cpf]?.trim() || null : null,
  }));
}
