import { v4 as uuidv4 } from 'uuid';
import { supabase, getQuarterFromDate } from './db';

type ParsedTransaction = {
  date: string;
  description: string;
  amount: number;
  counterparty: string;
  reference: string;
  accountNumber: string;
};

export function parseCSV(content: string, bankFormat?: string): ParsedTransaction[] {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const format = bankFormat || detectBankFormat(lines);

  switch (format) {
    case 'kbc':
      return parseKBC(lines);
    case 'belfius':
      return parseBelfius(lines);
    case 'ing':
      return parseING(lines);
    case 'bnp':
      return parseBNP(lines);
    case 'generic':
    default:
      return parseGeneric(lines);
  }
}

function detectBankFormat(lines: string[]): string {
  const header = lines[0].toLowerCase();

  if (header.includes('rekeningnummer') && header.includes('rubriek')) return 'kbc';
  if (header.includes('kredietkaart') && header.includes('handelaar')) return 'kbc';
  if (header.includes('rekening') && header.includes('boekingsdatum') && header.includes('valutadatum')) return 'belfius';
  if (header.includes('rekening') && header.includes('muntsoort') && header.includes('afschriftnummer')) return 'ing';
  if (header.includes('numéro de séquence') || header.includes('volgnummer')) return 'bnp';

  return 'generic';
}

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

function parseKBC(lines: string[]): ParsedTransaction[] {
  const header = splitCSVLine(lines[0]);
  const headerLower = header.map(h => h.toLowerCase().trim());

  // Detect credit card vs bank account format
  const isCreditCard = headerLower.some(h => h.includes('kredietkaart'));

  if (isCreditCard) {
    const dateIdx = headerLower.findIndex(h => h.includes('datum verrichting'));
    const amountEurIdx = headerLower.findIndex(h => h === 'bedrag in eur');
    const amountIdx = amountEurIdx >= 0 ? amountEurIdx : headerLower.findIndex(h => h === 'bedrag');
    const nameIdx = headerLower.findIndex(h => h.includes('handelaar'));
    const descIdx = headerLower.findIndex(h => h.includes('toelichting'));
    const locationIdx = headerLower.findIndex(h => h === 'locatie');
    const accountIdx = headerLower.findIndex(h => h.includes('kredietkaart'));

    return lines.slice(1).map(line => {
      const cols = splitCSVLine(line);
      if (cols.length < 5) return null;
      const description = cols[descIdx] || cols[locationIdx] || '';
      return {
        date: parseDate(cols[dateIdx] || ''),
        description: description.trim(),
        amount: parseAmount(cols[amountIdx] || ''),
        counterparty: (cols[nameIdx] || '').trim(),
        reference: '',
        accountNumber: (cols[accountIdx] || '').trim(),
      };
    }).filter((t): t is ParsedTransaction => t !== null && !!t.date && t.amount !== 0);
  }

  // Regular KBC bank account format
  const dateIdx = headerLower.findIndex(h => h === 'datum');
  const descIdx = headerLower.findIndex(h => h === 'omschrijving');
  const amountIdx = headerLower.findIndex(h => h === 'bedrag');
  const nameIdx = headerLower.findIndex(h => h === 'naam');
  const detailIdx = headerLower.findIndex(h => h === 'detail');
  const accountIdx = headerLower.findIndex(h => h === 'rekeningnummer');

  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    return {
      date: parseDate(cols[dateIdx] || ''),
      description: cols[descIdx] || '',
      amount: parseAmount(cols[amountIdx] || ''),
      counterparty: cols[nameIdx] || '',
      reference: cols[detailIdx] || '',
      accountNumber: cols[accountIdx] || '',
    };
  }).filter(t => t.date && t.amount !== 0);
}

function parseBelfius(lines: string[]): ParsedTransaction[] {
  const header = splitCSVLine(lines[0]);
  const dateIdx = header.findIndex(h => h.toLowerCase().includes('boekingsdatum'));
  const descIdx = header.findIndex(h => h.toLowerCase() === 'omschrijving' || h.toLowerCase() === 'mededeling');
  const amountIdx = header.findIndex(h => h.toLowerCase() === 'bedrag');
  const nameIdx = header.findIndex(h => h.toLowerCase().includes('naam tegenpartij') || h.toLowerCase().includes('naam'));
  const accountIdx = header.findIndex(h => h.toLowerCase() === 'rekening');
  const counterAccountIdx = header.findIndex(h => h.toLowerCase().includes('rekening tegenpartij'));

  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    return {
      date: parseDate(cols[dateIdx] || ''),
      description: cols[descIdx >= 0 ? descIdx : 10] || '',
      amount: parseAmount(cols[amountIdx] || ''),
      counterparty: cols[nameIdx >= 0 ? nameIdx : 5] || '',
      reference: cols[counterAccountIdx >= 0 ? counterAccountIdx : 4] || '',
      accountNumber: cols[accountIdx >= 0 ? accountIdx : 0] || '',
    };
  }).filter(t => t.date && t.amount !== 0);
}

function parseING(lines: string[]): ParsedTransaction[] {
  const header = splitCSVLine(lines[0]);
  const dateIdx = header.findIndex(h => h.toLowerCase().includes('datum'));
  const descIdx = header.findIndex(h => h.toLowerCase().includes('omschrijving') || h.toLowerCase().includes('detail'));
  const amountIdx = header.findIndex(h => h.toLowerCase().includes('bedrag'));
  const nameIdx = header.findIndex(h => h.toLowerCase().includes('naam') || h.toLowerCase().includes('tegenpartij'));
  const accountIdx = header.findIndex(h => h.toLowerCase().includes('rekening'));

  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    return {
      date: parseDate(cols[dateIdx >= 0 ? dateIdx : 2] || ''),
      description: cols[descIdx >= 0 ? descIdx : 8] || '',
      amount: parseAmount(cols[amountIdx >= 0 ? amountIdx : 6] || ''),
      counterparty: cols[nameIdx >= 0 ? nameIdx : 4] || '',
      reference: '',
      accountNumber: cols[accountIdx >= 0 ? accountIdx : 0] || '',
    };
  }).filter(t => t.date && t.amount !== 0);
}

function parseBNP(lines: string[]): ParsedTransaction[] {
  const header = splitCSVLine(lines[0]);
  const dateIdx = Math.max(0, header.findIndex(h => h.toLowerCase().includes('datum') || h.toLowerCase().includes('date')));
  const descIdx = Math.max(0, header.findIndex(h => h.toLowerCase().includes('omschrijving') || h.toLowerCase().includes('description')));
  const amountIdx = Math.max(0, header.findIndex(h => h.toLowerCase().includes('bedrag') || h.toLowerCase().includes('montant')));
  const nameIdx = header.findIndex(h => h.toLowerCase().includes('naam') || h.toLowerCase().includes('nom'));

  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    return {
      date: parseDate(cols[dateIdx] || ''),
      description: cols[descIdx] || '',
      amount: parseAmount(cols[amountIdx] || ''),
      counterparty: nameIdx >= 0 ? cols[nameIdx] || '' : '',
      reference: '',
      accountNumber: '',
    };
  }).filter(t => t.date && t.amount !== 0);
}

function parseGeneric(lines: string[]): ParsedTransaction[] {
  const sep = lines[0].includes(';') ? ';' : ',';
  const header = splitCSVLine(lines[0], sep);

  const dateIdx = header.findIndex(h => /date|datum/i.test(h));
  const descIdx = header.findIndex(h => /desc|omschrijving|mededeling|communication/i.test(h));
  const amountIdx = header.findIndex(h => /amount|bedrag|montant/i.test(h));
  const nameIdx = header.findIndex(h => /name|naam|tegenpartij|counterparty|beneficiary/i.test(h));
  const refIdx = header.findIndex(h => /ref|reference|mededeling/i.test(h));

  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line, sep);
    return {
      date: parseDate(cols[dateIdx >= 0 ? dateIdx : 0] || ''),
      description: cols[descIdx >= 0 ? descIdx : 1] || '',
      amount: parseAmount(cols[amountIdx >= 0 ? amountIdx : 2] || ''),
      counterparty: nameIdx >= 0 ? cols[nameIdx] : '',
      reference: refIdx >= 0 ? cols[refIdx] : '',
      accountNumber: '',
    };
  }).filter(t => t.date && t.amount !== 0);
}

export async function importTransactions(parsed: ParsedTransaction[]): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const tx of parsed) {
    if (!tx.date) continue;

    // Duplicate check
    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('date', tx.date)
      .eq('amount', tx.amount)
      .eq('counterparty', tx.counterparty)
      .limit(1);

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
