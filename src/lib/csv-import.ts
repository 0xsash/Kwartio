import { v4 as uuidv4 } from 'uuid';
import db, { getQuarterFromDate } from './db';

type ParsedTransaction = {
  date: string;
  description: string;
  amount: number;
  counterparty: string;
  reference: string;
  accountNumber: string;
};

// Detect and parse different Belgian bank CSV formats
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
  // Handle European format: 1.234,56 or 1234,56
  let cleaned = str.replace(/\s/g, '').replace(/"/g, '');
  // If contains comma as decimal separator
  if (cleaned.includes(',') && (cleaned.indexOf(',') > cleaned.lastIndexOf('.') || !cleaned.includes('.'))) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  return parseFloat(cleaned) || 0;
}

function parseDate(str: string): string {
  if (!str) return '';
  str = str.replace(/"/g, '').trim();

  // DD/MM/YYYY
  let match = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  // YYYY-MM-DD
  match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return str;

  // YYYYMMDD
  match = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  return str;
}

function parseKBC(lines: string[]): ParsedTransaction[] {
  // KBC format: Rekeningnummer;Rubrieknaam;Naam;Munt;Afschriftnummer;Datum;Omschrijving;Valuta;Detail;Bedrag;...
  const header = splitCSVLine(lines[0]);
  const dateIdx = header.findIndex(h => h.toLowerCase() === 'datum');
  const descIdx = header.findIndex(h => h.toLowerCase() === 'omschrijving');
  const amountIdx = header.findIndex(h => h.toLowerCase() === 'bedrag');
  const nameIdx = header.findIndex(h => h.toLowerCase() === 'naam');
  const detailIdx = header.findIndex(h => h.toLowerCase() === 'detail');
  const accountIdx = header.findIndex(h => h.toLowerCase() === 'rekeningnummer');

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
  // Belfius: Rekening;Boekingsdatum;Afschriftnummer;Transactienummer;Rekening tegenpartij;Naam tegenpartij;Straat;Postcode;Plaats;Land;Omschrijving;Bedrag;Munt;Valutadatum;...
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
  // Try to auto-detect columns from header
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

export function importTransactions(parsed: ParsedTransaction[]): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions (id, date, description, amount, counterparty, reference, account_number, source, quarter, year)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'csv_import', ?, ?)
  `);

  let imported = 0;
  const insertMany = db.transaction((txns: ParsedTransaction[]) => {
    for (const tx of txns) {
      if (!tx.date) continue;
      const { quarter, year } = getQuarterFromDate(tx.date);
      const id = uuidv4();
      insert.run(id, tx.date, tx.description, tx.amount, tx.counterparty, tx.reference, tx.accountNumber, quarter, year);
      imported++;
    }
  });

  insertMany(parsed);
  return imported;
}
