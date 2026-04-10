import { v4 as uuidv4 } from 'uuid';
import { supabase, getQuarterFromDate } from './db';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export type ParsedTransaction = {
  date: string;
  description: string;
  amount: number;
  counterparty: string;
  reference: string;
  accountNumber: string;
};

function splitCSVLine(line: string, separator: string = ';'): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === separator && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseAmount(str: string): number {
  if (!str) return 0;
  let cleaned = str.replace(/\s/g, '').replace(/"/g, '');

  // Accounting negative: (45.50) → -45.50
  let sign = 1;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    sign = -1;
    cleaned = cleaned.slice(1, -1);
  }

  // Strip trailing currency codes/labels (EUR, USD, CR, DR, etc.)
  cleaned = cleaned.replace(/[a-zA-Z]+$/g, '');

  // European format: comma as decimal separator
  if (cleaned.includes(',') && (cleaned.indexOf(',') > cleaned.lastIndexOf('.') || !cleaned.includes('.'))) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const n = parseFloat(cleaned);
  if (isNaN(n)) return 0;
  return sign * n;
}

function parseDate(str: string): string {
  if (!str) return '';
  str = str.replace(/"/g, '').trim();

  let match = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return str;

  match = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  return str;
}

const CSV_MAPPING_PROMPT = `You are analyzing a bank CSV file. Given the header row and a few sample data rows, identify which columns contain the following information:

- date: The transaction date (could be "datum", "date", "boekingsdatum", "datum verrichting", etc.)
- amount: The transaction amount in EUR (prefer "bedrag in EUR" over "bedrag" if both exist; could also be "amount", "montant")
- counterparty: The name of the other party (could be "naam", "handelaar", "tegenpartij", "name", "beneficiary", "merchant")
- description: A description or communication (could be "omschrijving", "mededeling", "toelichting", "description", "communication")
- reference: A reference number (could be "referentie", "mededeling", "detail", "reference")
- account_number: The account/card number (could be "rekeningnummer", "rekening", "kredietkaart", "account")

Return a JSON object mapping each field to the EXACT column header name from the CSV. If a field cannot be identified, use null.

Example response:
{"date": "datum verrichting", "amount": "bedrag in EUR", "counterparty": "Handelaar", "description": "toelichting", "reference": null, "account_number": "kredietkaart"}

Also detect the separator (usually ; or ,).

Return ONLY a JSON object with this format:
{"separator": ";", "date": "column_name", "amount": "column_name", "counterparty": "column_name", "description": "column_name", "reference": "column_name", "account_number": "column_name"}`;

type ColumnMapping = {
  separator: string;
  date: string | null;
  amount: string | null;
  counterparty: string | null;
  description: string | null;
  reference: string | null;
  account_number: string | null;
};

async function detectColumnsWithClaude(headerAndSample: string): Promise<ColumnMapping> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `${CSV_MAPPING_PROMPT}\n\nHere are the first lines of the CSV:\n\n${headerAndSample}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Could not analyze CSV format');
  }

  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonStr);
}

export type ParseCSVResult = {
  transactions: ParsedTransaction[];
  diagnostic: string;
};

// Pick the most likely header row: the line with the most column separators
// (handles files with metadata rows at the top).
function findHeaderLine(lines: string[], sep: string): number {
  let best = 0;
  let bestCount = -1;
  const scanLimit = Math.min(lines.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const count = (lines[i].match(new RegExp(`\\${sep}`, 'g')) || []).length;
    if (count > bestCount) {
      bestCount = count;
      best = i;
    }
  }
  return best;
}

export async function parseCSV(content: string): Promise<ParseCSVResult> {
  const allLines = content.split(/\r?\n/).filter((l) => l.trim());
  if (allLines.length < 2) {
    return { transactions: [], diagnostic: `Bestand bevat slechts ${allLines.length} regel(s).` };
  }

  // Detect separator from the first few lines
  const sepGuess = allLines.slice(0, 5).some((l) => l.includes(';')) ? ';' : ',';

  // Skip metadata rows — header is the line with the most separators
  const headerLineIdx = findHeaderLine(allLines, sepGuess);
  const lines = allLines.slice(headerLineIdx);

  if (lines.length < 2) {
    return { transactions: [], diagnostic: 'Geen datarijen onder de herkende header.' };
  }

  // Send header + up to 3 sample rows to Claude for column detection
  const sample = lines.slice(0, Math.min(4, lines.length)).join('\n');
  let mapping: ColumnMapping;
  try {
    mapping = await detectColumnsWithClaude(sample);
  } catch (e) {
    throw new Error(`Claude kon het CSV-formaat niet herkennen: ${(e as Error).message}`);
  }

  const sep = mapping.separator || sepGuess;
  const header = splitCSVLine(lines[0], sep);
  const headerLower = header.map((h) => h.toLowerCase().trim());

  // Bidirectional fuzzy match: exact, then header-contains-target, then target-contains-header
  function findCol(name: string | null): number {
    if (!name) return -1;
    const target = name.toLowerCase().trim();
    if (!target) return -1;

    // Exact match first
    const exact = headerLower.indexOf(target);
    if (exact >= 0) return exact;

    // Header contains target (Claude returned shorter name than header)
    const contains = headerLower.findIndex((h) => h.includes(target));
    if (contains >= 0) return contains;

    // Target contains header (Claude returned longer name than header)
    return headerLower.findIndex((h) => h.length > 2 && target.includes(h));
  }

  const dateIdx = findCol(mapping.date);
  const amountIdx = findCol(mapping.amount);
  const counterpartyIdx = findCol(mapping.counterparty);
  const descIdx = findCol(mapping.description);
  const refIdx = findCol(mapping.reference);
  const accountIdx = findCol(mapping.account_number);

  // Fallback: scan headers for common patterns if Claude missed fields
  function findByPatterns(patterns: RegExp[]): number {
    for (let i = 0; i < headerLower.length; i++) {
      if (patterns.some((p) => p.test(headerLower[i]))) return i;
    }
    return -1;
  }

  const effectiveDateIdx = dateIdx >= 0 ? dateIdx : findByPatterns([/datum/, /date/, /boekingsdatum/]);
  let effectiveAmountIdx = amountIdx >= 0 ? amountIdx : findByPatterns([/bedrag/, /amount/, /montant/]);

  // Handle separate debit/credit columns (common on credit-card CSVs)
  let debitIdx = -1;
  let creditIdx = -1;
  if (effectiveAmountIdx < 0) {
    debitIdx = findByPatterns([/debet$/, /debit$/, /uit$/, /afgeboekt/]);
    creditIdx = findByPatterns([/credit$/, /in$/, /bijgeboekt/]);
  }

  if (effectiveDateIdx < 0) {
    return {
      transactions: [],
      diagnostic: `Geen datum-kolom gevonden. Headers: [${header.join(', ')}]. Claude zag: date=${mapping.date || 'null'}.`,
    };
  }
  if (effectiveAmountIdx < 0 && (debitIdx < 0 || creditIdx < 0)) {
    return {
      transactions: [],
      diagnostic: `Geen bedrag-kolom gevonden. Headers: [${header.join(', ')}]. Claude zag: amount=${mapping.amount || 'null'}.`,
    };
  }

  const dataLines = lines.slice(1);
  const rawParsed = dataLines.map((line) => {
    const cols = splitCSVLine(line, sep);
    if (cols.length < 2) return null;

    let amount = 0;
    if (effectiveAmountIdx >= 0) {
      amount = parseAmount(cols[effectiveAmountIdx] || '');
    } else if (debitIdx >= 0 || creditIdx >= 0) {
      const debit = debitIdx >= 0 ? parseAmount(cols[debitIdx] || '') : 0;
      const credit = creditIdx >= 0 ? parseAmount(cols[creditIdx] || '') : 0;
      // Debit reduces balance (negative), credit increases (positive)
      amount = credit - Math.abs(debit);
    }

    return {
      date: parseDate(cols[effectiveDateIdx] || ''),
      description: descIdx >= 0 ? (cols[descIdx] || '').trim() : '',
      amount,
      counterparty: counterpartyIdx >= 0 ? (cols[counterpartyIdx] || '').trim() : '',
      reference: refIdx >= 0 ? (cols[refIdx] || '').trim() : '',
      accountNumber: accountIdx >= 0 ? (cols[accountIdx] || '').trim() : '',
    };
  });

  const transactions = rawParsed.filter(
    (t): t is ParsedTransaction => t !== null && !!t.date && t.amount !== 0,
  );

  let diagnostic = '';
  if (transactions.length === 0) {
    const droppedByDate = rawParsed.filter((t) => t && !t.date).length;
    const droppedByAmount = rawParsed.filter((t) => t && !!t.date && t.amount === 0).length;
    const firstDataRow = dataLines[0] || '(geen)';
    diagnostic =
      `${dataLines.length} datarijen gelezen, 0 bruikbaar. ` +
      `Kolommen: date=${header[effectiveDateIdx] || '?'}, amount=${effectiveAmountIdx >= 0 ? header[effectiveAmountIdx] : debitIdx >= 0 || creditIdx >= 0 ? 'debet/credit' : '?'}. ` +
      `${droppedByDate} zonder datum, ${droppedByAmount} met bedrag=0. ` +
      `Eerste datarij: "${firstDataRow.slice(0, 120)}"`;
  }

  return { transactions, diagnostic };
}

export async function importTransactions(parsed: ParsedTransaction[]): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const tx of parsed) {
    if (!tx.date) continue;

    // Duplicate check — MUST include account_number, otherwise the same
    // transaction on two different cards gets silently dropped.
    let dupQuery = supabase
      .from('transactions')
      .select('id')
      .eq('date', tx.date)
      .eq('amount', tx.amount)
      .eq('counterparty', tx.counterparty);

    if (tx.accountNumber) {
      dupQuery = dupQuery.eq('account_number', tx.accountNumber);
    } else {
      dupQuery = dupQuery.is('account_number', null);
    }

    const { data: existing } = await dupQuery.limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { quarter, year } = getQuarterFromDate(tx.date);
    const id = uuidv4();

    await supabase.from('transactions').insert({
      id,
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      counterparty: tx.counterparty,
      reference: tx.reference,
      account_number: tx.accountNumber,
      source: 'csv_import',
      quarter,
      year,
    });

    imported++;
  }

  return { imported, skipped };
}
