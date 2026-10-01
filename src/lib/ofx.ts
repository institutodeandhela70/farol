// Parser de extrato bancário OFX 1.02 (SGML) — roda no browser, sem lib externa.
// O formato permite duas variações pra tag-folha: com fechamento inline
// (`<TRNTYPE>DEBIT</TRNTYPE>`) ou sem (`<FITID>abc123`, o SGML aceita fechamento
// implícito) — normalizamos linha a linha pros dois casos antes de tratar como XML.

export interface ParsedOfxTransaction {
  fitid: string | null;
  trnType: string | null;
  postedAt: string | null; // YYYY-MM-DD
  amount: number | null;
  memo: string | null;
}

export interface ParsedOfxAccount {
  bankId: string | null;
  acctId: string | null;
  acctType: string | null;
}

export interface ParsedOfx {
  account: ParsedOfxAccount;
  transactions: ParsedOfxTransaction[];
}

function escapeXml(value: string): string {
  return value.replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, "&amp;");
}

export function sgmlToXml(raw: string): string {
  const ofxStart = raw.search(/<OFX>/i);
  const body = ofxStart >= 0 ? raw.slice(ofxStart) : raw;

  const openTagRe = /^<([A-Za-z0-9.]+)>(.*)$/;
  const lines: string[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(openTagRe);
    if (!match) {
      // Tag de fechamento sozinha (</STMTTRN>) ou linha sem tag — mantém como está.
      lines.push(line);
      continue;
    }

    const [, tag, rest] = match;
    if (rest === "") {
      // Tag container, sem valor.
      lines.push(`<${tag}>`);
    } else {
      // Tag-folha, com ou sem fechamento na mesma linha — extrai o valor cru
      // (removendo o fechamento se já vier) e sempre escapa antes de remontar,
      // porque o valor pode ter "&" (ex: "ASSESSORIA & CIA"), inválido em XML cru.
      const closeTag = `</${tag}>`;
      const value = rest.endsWith(closeTag) ? rest.slice(0, -closeTag.length) : rest;
      lines.push(`<${tag}>${escapeXml(value)}</${tag}>`);
    }
  }

  return lines.join("\n");
}

function text(el: Element | null, tag: string): string | null {
  const found = el?.getElementsByTagName(tag)[0];
  const value = found?.textContent?.trim();
  return value ? value : null;
}

function toIsoDate(dtposted: string | null): string | null {
  if (!dtposted || dtposted.length < 8) return null;
  const y = dtposted.slice(0, 4);
  const m = dtposted.slice(4, 6);
  const d = dtposted.slice(6, 8);
  return `${y}-${m}-${d}`;
}

export function parseOfx(raw: string): ParsedOfx {
  const xml = sgmlToXml(raw);
  const doc = new DOMParser().parseFromString(xml, "text/xml");

  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Arquivo não parece ser um OFX válido.");
  }

  const acctEl = doc.getElementsByTagName("BANKACCTFROM")[0] ?? null;
  const account: ParsedOfxAccount = {
    bankId: text(acctEl, "BANKID"),
    acctId: text(acctEl, "ACCTID"),
    acctType: text(acctEl, "ACCTTYPE"),
  };

  const transactions: ParsedOfxTransaction[] = [];
  const stmtNodes = doc.getElementsByTagName("STMTTRN");
  for (let i = 0; i < stmtNodes.length; i++) {
    const node = stmtNodes[i];
    const amountRaw = text(node, "TRNAMT");
    transactions.push({
      fitid: text(node, "FITID"),
      trnType: text(node, "TRNTYPE"),
      postedAt: toIsoDate(text(node, "DTPOSTED")),
      amount: amountRaw !== null ? Number(amountRaw) : null,
      memo: text(node, "MEMO") ?? text(node, "NAME"),
    });
  }

  if (transactions.length === 0) {
    throw new Error("Nenhuma transação encontrada no arquivo — confira se é um extrato OFX válido.");
  }

  return { account, transactions };
}
