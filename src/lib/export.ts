import db, { type Invoice, type Transaction, getAllSettings } from './db';
import * as XLSX from 'xlsx';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { generateBankStatementPDF, generateCoverSheetPDF } from './pdf-generate';

export const CATEGORY_LABELS: Record<string, string> = {
  software: 'Software & Licenties',
  hosting: 'Hosting & Cloud',
  telecom: 'Telecom & Internet',
  office_supplies: 'Kantoorbenodigdheden',
  travel: 'Reiskosten',
  insurance: 'Verzekeringen',
  professional_services: 'Professionele Diensten',
  marketing: 'Marketing & Reclame',
  subscriptions: 'Abonnementen',
  hardware: 'Hardware & Apparatuur',
  utilities: 'Nutsvoorzieningen',
  meals: 'Maaltijden & Representatie',
  transport: 'Transport',
  other: 'Overige',
};

const VAT_CODES: Record<number, string> = {
  0: '0% BTW',
  6: '6% BTW',
  12: '12% BTW',
  21: '21% BTW',
};

function getInvoices(year: number, quarter: string): Invoice[] {
  return db.prepare(
    "SELECT * FROM invoices WHERE year = ? AND quarter = ? AND classification = 'professional' ORDER BY invoice_date"
  ).all(year, quarter) as Invoice[];
}

function getTransactions(year: number, quarter: string) {
  return db.prepare(
    "SELECT t.*, i.vendor as matched_vendor, i.original_filename as matched_invoice FROM transactions t LEFT JOIN invoices i ON t.matched_invoice_id = i.id WHERE t.year = ? AND t.quarter = ? AND t.classification = 'professional' ORDER BY t.date"
  ).all(year, quarter) as (Transaction & { matched_vendor: string | null; matched_invoice: string | null })[];
}

function buildCategoryTotals(invoices: Invoice[]) {
  const categoryTotals = new Map<string, { count: number; total: number; vat: number }>();
  for (const inv of invoices) {
    const cat = inv.category || 'other';
    const existing = categoryTotals.get(cat) || { count: 0, total: 0, vat: 0 };
    existing.count++;
    existing.total += inv.amount || 0;
    existing.vat += inv.vat_amount || 0;
    categoryTotals.set(cat, existing);
  }
  return categoryTotals;
}

// Standalone Excel workbook
export function generateExcelWorkbook(year: number, quarter: string): Buffer {
  const invoices = getInvoices(year, quarter);
  const transactions = getTransactions(year, quarter);
  const settings = getAllSettings();
  const categoryTotals = buildCategoryTotals(invoices);

  const wb = XLSX.utils.book_new();

  // Sheet 1: Samenvatting
  const summaryData: Record<string, unknown>[] = [];

  if (settings.business_name) {
    summaryData.push({ 'Kwartaal': `${settings.business_name}`, 'Categorie': settings.vat_number || '', 'Aantal': '', 'Totaal excl. BTW': '', 'BTW': '', 'Totaal incl. BTW': '' });
  }
  summaryData.push({ 'Kwartaal': `${quarter} ${year}`, 'Categorie': '', 'Aantal': '', 'Totaal excl. BTW': '', 'BTW': '', 'Totaal incl. BTW': '' });

  let grandTotal = 0;
  let grandVat = 0;

  for (const [cat, data] of categoryTotals.entries()) {
    grandTotal += data.total;
    grandVat += data.vat;
    summaryData.push({
      'Kwartaal': '',
      'Categorie': CATEGORY_LABELS[cat] || cat,
      'Aantal': data.count,
      'Totaal excl. BTW': roundTwo(data.total - data.vat),
      'BTW': roundTwo(data.vat),
      'Totaal incl. BTW': roundTwo(data.total),
    });
  }

  summaryData.push({
    'Kwartaal': '',
    'Categorie': 'TOTAAL',
    'Aantal': invoices.length,
    'Totaal excl. BTW': roundTwo(grandTotal - grandVat),
    'BTW': roundTwo(grandVat),
    'Totaal incl. BTW': roundTwo(grandTotal),
  });

  const ws1 = XLSX.utils.json_to_sheet(summaryData);
  ws1['!cols'] = [{ wch: 20 }, { wch: 28 }, { wch: 8 }, { wch: 18 }, { wch: 12 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Samenvatting');

  // Sheet 2: Facturen
  const invoiceRows = invoices.map((inv, i) => ({
    '#': i + 1,
    'Datum': inv.invoice_date || '',
    'Leverancier': inv.vendor || '',
    'Factuurnummer': inv.invoice_number || '',
    'Omschrijving': inv.description || '',
    'Categorie': CATEGORY_LABELS[inv.category || 'other'] || inv.category || '',
    'Bedrag excl. BTW': roundTwo((inv.amount || 0) - (inv.vat_amount || 0)),
    'BTW %': inv.vat_rate ? `${inv.vat_rate}%` : '',
    'BTW Bedrag': roundTwo(inv.vat_amount || 0),
    'Totaal': roundTwo(inv.amount || 0),
    'BTW Code': inv.vat_rate ? (VAT_CODES[inv.vat_rate] || `${inv.vat_rate}% BTW`) : '',
    'Bestandsnaam': inv.original_filename,
  }));

  const ws2 = XLSX.utils.json_to_sheet(invoiceRows);
  ws2['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 25 }, { wch: 18 }, { wch: 35 },
    { wch: 25 }, { wch: 16 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Facturen');

  // Sheet 3: Transacties
  const txRows = transactions.map((tx, i) => ({
    '#': i + 1,
    'Datum': tx.date,
    'Omschrijving': tx.description || '',
    'Tegenpartij': tx.counterparty || '',
    'Bedrag': roundTwo(tx.amount),
    'Categorie': CATEGORY_LABELS[tx.category || 'other'] || tx.category || '',
    'Gekoppelde Factuur': tx.matched_invoice || '',
    'Referentie': tx.reference || '',
  }));

  const ws3 = XLSX.utils.json_to_sheet(txRows);
  ws3['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 35 }, { wch: 25 },
    { wch: 12 }, { wch: 25 }, { wch: 30 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws3, 'Transacties');

  // Sheet 4: BTW Overzicht
  const vatByRate = new Map<number, { base: number; vat: number; count: number }>();
  for (const inv of invoices) {
    if (inv.vat_rate != null && inv.amount != null) {
      const rate = inv.vat_rate;
      const existing = vatByRate.get(rate) || { base: 0, vat: 0, count: 0 };
      existing.base += (inv.amount - (inv.vat_amount || 0));
      existing.vat += (inv.vat_amount || 0);
      existing.count++;
      vatByRate.set(rate, existing);
    }
  }

  const vatRows = Array.from(vatByRate.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rate, data]) => ({
      'BTW Tarief': `${rate}%`,
      'Aantal Facturen': data.count,
      'Basis (excl. BTW)': roundTwo(data.base),
      'BTW Bedrag': roundTwo(data.vat),
      'Totaal (incl. BTW)': roundTwo(data.base + data.vat),
    }));

  const ws4 = XLSX.utils.json_to_sheet(vatRows);
  ws4['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'BTW Overzicht');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// CSV exports
export function generateInvoiceCSV(year: number, quarter: string): string {
  const invoices = getInvoices(year, quarter);
  const header = 'Datum;Leverancier;Factuurnummer;Omschrijving;Categorie;Bedrag excl. BTW;BTW %;BTW Bedrag;Totaal;Bestandsnaam';
  const rows = invoices.map(inv =>
    [
      inv.invoice_date || '',
      csvEscape(inv.vendor || ''),
      csvEscape(inv.invoice_number || ''),
      csvEscape(inv.description || ''),
      csvEscape(CATEGORY_LABELS[inv.category || 'other'] || ''),
      roundTwo((inv.amount || 0) - (inv.vat_amount || 0)),
      inv.vat_rate || '',
      roundTwo(inv.vat_amount || 0),
      roundTwo(inv.amount || 0),
      csvEscape(inv.original_filename),
    ].join(';')
  );
  return [header, ...rows].join('\n');
}

export function generateTransactionCSV(year: number, quarter: string): string {
  const transactions = getTransactions(year, quarter);
  const header = 'Datum;Tegenpartij;Omschrijving;Bedrag;Categorie;Gekoppelde Factuur;Referentie';
  const rows = transactions.map(tx =>
    [
      tx.date,
      csvEscape(tx.counterparty || ''),
      csvEscape(tx.description || ''),
      roundTwo(tx.amount),
      csvEscape(CATEGORY_LABELS[tx.category || 'other'] || ''),
      csvEscape(tx.matched_invoice || ''),
      csvEscape(tx.reference || ''),
    ].join(';')
  );
  return [header, ...rows].join('\n');
}

// ZIP of just invoice PDFs
export async function generateInvoicesZip(year: number, quarter: string): Promise<Buffer> {
  const invoices = getInvoices(year, quarter);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    for (const inv of invoices) {
      const filePath = path.join(process.cwd(), 'uploads', inv.file_path);
      if (fs.existsSync(filePath)) {
        const cat = CATEGORY_LABELS[inv.category || 'other'] || 'Overige';
        const safeVendor = (inv.vendor || 'Onbekend').replace(/[^a-zA-Z0-9\s\-]/g, '');
        const ext = path.extname(inv.original_filename);
        const fileName = `${inv.invoice_date || 'geen_datum'}_${safeVendor}_EUR${inv.amount?.toFixed(2) || '0.00'}${ext}`;
        archive.file(filePath, { name: `${cat}/${fileName}` });
      }
    }

    archive.finalize();
  });
}

// Full accountant package with cover sheet + bank statement
export async function generateAccountantPackage(year: number, quarter: string): Promise<Buffer> {
  const invoices = getInvoices(year, quarter);
  const transactions = getTransactions(year, quarter);
  const settings = getAllSettings();
  const categoryTotals = buildCategoryTotals(invoices);

  let grandTotal = 0;
  let grandVat = 0;
  const categories: Array<{ name: string; count: number; total: number }> = [];
  for (const [cat, data] of categoryTotals.entries()) {
    grandTotal += data.total;
    grandVat += data.vat;
    categories.push({ name: CATEGORY_LABELS[cat] || cat, count: data.count, total: data.total });
  }

  const [coverSheet, bankStatement] = await Promise.all([
    generateCoverSheetPDF(year, quarter, settings, {
      invoiceCount: invoices.length,
      transactionCount: transactions.length,
      totalAmount: grandTotal,
      totalVat: grandVat,
      categories,
    }),
    generateBankStatementPDF(year, quarter, settings),
  ]);

  const excelBuffer = generateExcelWorkbook(year, quarter);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Cover sheet
    archive.append(coverSheet, { name: `Voorblad_${quarter}_${year}.pdf` });

    // Excel
    archive.append(excelBuffer, { name: `Overzichten/Kwartio_${year}_${quarter}_Boekhouding.xlsx` });

    // Bank statement
    archive.append(bankStatement, { name: `Bankafschriften/Bankafschrift_${quarter}_${year}.pdf` });

    // Invoice files by category
    for (const inv of invoices) {
      const filePath = path.join(process.cwd(), 'uploads', inv.file_path);
      if (fs.existsSync(filePath)) {
        const cat = CATEGORY_LABELS[inv.category || 'other'] || 'Overige';
        const safeVendor = (inv.vendor || 'Onbekend').replace(/[^a-zA-Z0-9\s\-]/g, '');
        const ext = path.extname(inv.original_filename);
        const fileName = `${inv.invoice_date || 'geen_datum'}_${safeVendor}_EUR${inv.amount?.toFixed(2) || '0.00'}${ext}`;
        archive.file(filePath, { name: `Facturen/${cat}/${fileName}` });
      }
    }

    archive.finalize();
  });
}

// Legacy function kept for backward compat
export async function generateQuarterlyExport(year: number, quarter: string): Promise<string> {
  const exportDir = path.join(process.cwd(), 'data', 'exports');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  const zipPath = path.join(exportDir, `Kwartio_${year}_${quarter}.zip`);
  const buffer = await generateAccountantPackage(year, quarter);
  fs.writeFileSync(zipPath, buffer);
  return zipPath;
}

function roundTwo(n: number): number {
  return Math.round(n * 100) / 100;
}

function csvEscape(s: string): string {
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
