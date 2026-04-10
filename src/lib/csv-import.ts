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
  if (cleaned.includes(',') && (cleaned.indexOf(',') > cleaned.lastIndexOf('.') || !cleaned.includes('.'))) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  return parseFloat(cleaned) || 0;
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

export async function parseCSV(content: string): Promise<ParsedTransaction[]> {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Send header + up to 3 sample rows to Claude for column detection
  const sample = lines.slice(0, Math.min(4, lines.length)).join('\n');
  const mapping = await detectColumnsWithClaude(sample);

  const sep = mapping.separator || (lines[0].includes(';') ? ';' : ',');
  const header = splitCSVLine(lines[0], sep);
  const headerLower = header.map(h => h.toLowerCase().trim());

  // Find column indices from the mapping
  function findCol(name: string | null): number {
    if (!name) return -1;
    const idx = headerLower.indexOf(name.toLowerCase().trim());
    if (idx >= 0) return idx;
    // Fuzzy match: check if any header contains the name
    return headerLower.findIndex(h => h.includes(name.toLowerCase().trim()));
  }

  const dateIdx = findCol(mapping.date);
  const amountIdx = findCol(mapping.amount);
  const counterpartyIdx = findCol(mapping.counterparty);
  const descIdx = findCol(mapping.description);
  const refIdx = findCol(mapping.reference);
  const accountIdx = findCol(mapping.account_number);

  if (dateIdx < 0 || amountIdx < 0) {
    throw new Error('Kon geen datum- of bedragkolom identificeren in dit CSV-bestand');
  }

  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line, sep);
    if (cols.length < 3) return null;
    return {
      date: parseDate(cols[dateIdx] || ''),
      description: descIdx >= 0 ? (cols[descIdx] || '').trim() : '',
      amount: parseAmount(cols[amountIdx] || ''),
      counterparty: counterpartyIdx >= 0 ? (cols[counterpartyIdx] || '').trim() : '',
      reference: refIdx >= 0 ? (cols[refIdx] || '').trim() : '',
      accountNumber: accountIdx >= 0 ? (cols[accountIdx] || '').trim() : '',
    };
  }).filter((t): t is ParsedTransaction => t !== null && !!t.date && t.amount !== 0);
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
